import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WASocket } from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode';
import type Redis from 'ioredis';
import { REDIS_PUB } from '../redis/redis.constants';
import { AcquiredLock, RedisLockService } from '../redis/redis-lock.service';
import { WhatsAppSessionRepository } from '../persistence/whatsapp-session.repository';
import { MediaStorageService } from '../storage/media-storage.service';
import { EventPublisherService } from '../events/event-publisher.service';
import { loadBaileys } from './baileys.loader';
import { invalidateAuthCache, useWhatsAppAuthState } from './whatsapp-auth-state';
import {
  describeMessageShape,
  extractMessageText,
  mapBaileysStatus,
  normalizeBrazilianPhone,
  unwrapMessageContent,
} from './message-extractor';

const SESSION_LOCK_TTL_MS = 30_000;
const SESSION_LOCK_RENEW_MS = 10_000;
const MESSAGE_DEDUP_TTL_MS = 10 * 60 * 1000;
const lockKey = (userId: string) => `wa:lock:session:${userId}`;

@Injectable()
export class SessionManagerService {
  private readonly logger = new Logger(SessionManagerService.name);
  private sessions = new Map<string, WASocket>();
  private pendingSessions = new Set<string>();
  private stores = new Map<string, Map<string, string>>();
  private readonly sessionLocks = new Map<string, AcquiredLock>();
  private readonly lockRenewers = new Map<string, NodeJS.Timeout>();
  private readonly processedMessageIds = new Map<string, number>();

  constructor(
    private readonly redisLock: RedisLockService,
    private readonly sessionRepository: WhatsAppSessionRepository,
    private readonly mediaStorage: MediaStorageService,
    private readonly events: EventPublisherService,
    @Inject(REDIS_PUB) private readonly redis: Redis,
  ) {}

  hasLocal(userId: string): boolean {
    return this.sessions.has(userId) || this.sessionLocks.has(userId);
  }

  isPending(userId: string): boolean {
    return this.pendingSessions.has(userId);
  }

  ownsLock(userId: string): boolean {
    return this.sessionLocks.has(userId);
  }

  async stopAll(): Promise<void> {
    for (const [, sock] of this.sessions) {
      try {
        (sock as any).end?.();
      } catch {}
    }
    const userIds = Array.from(this.sessionLocks.keys());
    this.sessions.clear();
    this.stores.clear();
    this.pendingSessions.clear();
    await Promise.all(userIds.map((u) => this.releaseSessionLock(u)));
  }

  async startSession(userId: string, targetPhoneNumber?: string | null): Promise<void> {
    this.logger.log(
      `startSession invocado (userId: ${userId}, targetPhone: ${targetPhoneNumber ?? 'nenhum'})`,
    );

    const existingSock = this.sessions.get(userId);
    if (existingSock) {
      const rawCurrent = existingSock.user?.id?.split(':')[0]?.split('@')[0];
      const currentPhone = rawCurrent ? normalizeBrazilianPhone('+' + rawCurrent) : null;
      const desiredPhone = targetPhoneNumber ? normalizeBrazilianPhone(targetPhoneNumber) : null;

      if (desiredPhone && currentPhone && currentPhone === desiredPhone) {
        this.logger.log(`Sessao ja pareada (${currentPhone}); re-emitindo CONNECTED`);
        await this.events.publishStatus({
          userId,
          status: 'CONNECTED',
          phone: currentPhone,
        });
        return;
      }
      if (desiredPhone && currentPhone && currentPhone !== desiredPhone) {
        this.logger.log(`Trocando numero ${currentPhone} -> ${desiredPhone}`);
        await this.forceResetSession(userId, existingSock);
      } else {
        if (currentPhone) {
          await this.events.publishStatus({
            userId,
            status: 'CONNECTED',
            phone: currentPhone,
          });
        }
        return;
      }
    }

    if (this.pendingSessions.has(userId)) {
      this.logger.log(`startSession ignorado — pending (${userId})`);
      return;
    }

    if (!this.sessionLocks.has(userId)) {
      const lock = await this.redisLock
        .acquire(lockKey(userId), SESSION_LOCK_TTL_MS)
        .catch(() => null);
      if (!lock) {
        this.logger.log(`startSession ignorado — outra instancia dona da sessao (${userId})`);
        return;
      }
      this.sessionLocks.set(userId, lock);
      this.startLockRenewal(userId, lock);
    }

    this.pendingSessions.add(userId);

    let DisconnectReason: any;
    let saveCreds: () => Promise<void>;
    let lidToPhone: Map<string, string>;
    let sock: WASocket;

    try {
      const baileys = await loadBaileys();
      DisconnectReason = baileys.DisconnectReason;

      const authState = await useWhatsAppAuthState(userId, this.sessionRepository, this.redis);
      saveCreds = authState.saveCreds;
      const { version } = await baileys.fetchLatestBaileysVersion();

      lidToPhone = new Map();
      this.stores.set(userId, lidToPhone);

      const noopLogger: any = {
        level: 'silent',
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: () => noopLogger,
      };

      sock = baileys.makeWASocket({
        version,
        auth: authState.state,
        printQRInTerminal: false,
        logger: noopLogger,
        browser: ['ConsigPro', 'Chrome', '1.0.0'],
      });

      this.sessions.set(userId, sock);
    } catch (err) {
      this.pendingSessions.delete(userId);
      await this.releaseSessionLock(userId);
      throw err;
    }

    this.pendingSessions.delete(userId);

    sock.ev.on('creds.update', saveCreds);

    const syncContacts = (contacts: { id: string; lid?: string }[]) => {
      for (const c of contacts) {
        if (c.lid && c.id.endsWith('@s.whatsapp.net')) {
          lidToPhone.set(c.lid, c.id);
        }
      }
    };
    sock.ev.on('contacts.upsert', syncContacts);
    sock.ev.on('contacts.update', syncContacts as any);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      const rawPhone = sock.user?.id?.split(':')[0]?.split('@')[0];
      const phone = rawPhone ? normalizeBrazilianPhone('+' + rawPhone) : null;

      if (qr) {
        this.logger.log(`QR gerado (userId: ${userId})`);
        const qrDataUrl = await QRCode.toDataURL(qr);
        await this.events.publishQr({ userId, qrDataUrl });
        await this.sessionRepository
          .setConnectionStatus(userId, 'PENDING', null)
          .catch((err) => this.logger.error(`Falha PENDING ${userId}:`, err));
      }

      if (connection === 'connecting') {
        this.logger.log(`connection=connecting (${phone ?? 'sem numero'}, ${userId})`);
      }

      if (connection === 'open') {
        this.logger.log(`connection=open (${phone}, ${userId})`);
        await this.sessionRepository
          .setConnectionStatus(userId, 'CONNECTED', phone)
          .catch((err) => this.logger.error(`Falha CONNECTED ${userId}:`, err));
        await this.events.publishStatus({
          userId,
          status: 'CONNECTED',
          phone,
        });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const reason =
          Object.entries(DisconnectReason ?? {}).find(([, v]) => v === statusCode)?.[0] ??
          'desconhecido';

        // socket substituido (forceResetSession ja trocou) — ignora
        if (this.sessions.get(userId) !== sock) {
          this.logger.log(`connection=close em socket SUBSTITUIDO — ignorando (${userId})`);
          return;
        }
        this.sessions.delete(userId);

        const previousPhone = await this.sessionRepository
          .getConnectedPhone(userId)
          .catch(() => null);

        this.logger.warn(
          `connection=close (${phone ?? previousPhone ?? '?'}, ${userId}, statusCode: ${statusCode}, reason: ${reason})`,
        );

        await this.sessionRepository
          .setConnectionStatus(userId, 'DISCONNECTED', null)
          .catch((err) => this.logger.error(`Falha DISCONNECTED ${userId}:`, err));
        await this.events.publishStatus({
          userId,
          status: 'DISCONNECTED',
          phone: previousPhone,
        });

        const loggedOut = statusCode === DisconnectReason.loggedOut;
        if (loggedOut) {
          this.logger.warn(`LOGOUT — removendo creds (${userId})`);
          await this.sessionRepository.delete(userId);
          await invalidateAuthCache(userId, this.redis);
          this.stores.delete(userId);
          await this.releaseSessionLock(userId);
        } else if (statusCode === DisconnectReason.connectionReplaced) {
          this.logger.warn(`connectionReplaced — liberando lock (${userId})`);
          this.stores.delete(userId);
          await this.releaseSessionLock(userId);
        } else {
          // reconnect agendado em 2s (rede instavel, 428, 515 etc)
          setTimeout(() => {
            this.startSession(userId).catch((err) =>
              this.logger.error(`Erro ao reconectar ${userId}:`, err),
            );
          }, 2000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const message of messages) {
        await this.handleIncomingMessage(userId, sock, message, lidToPhone).catch((err) =>
          this.logger.error(`Erro ao processar mensagem:`, err),
        );
      }
    });

    sock.ev.on('messages.update', async (updates) => {
      for (const u of updates) {
        const numericStatus = u.update?.status;
        if (numericStatus === undefined || numericStatus === null) continue;
        const wppId = u.key?.id;
        if (!wppId) continue;
        const mapped = mapBaileysStatus(numericStatus);
        if (!mapped) continue;
        await this.events.publishMessageStatus({
          userId,
          whatsappMessageId: wppId,
          status: mapped,
        });
      }
    });
  }

  /**
   * Job de envio: usado pelo SendMessageProcessor. Retorna whatsappMessageId
   * para o caller (bot-api) saber qual mensagem foi enviada.
   */
  async sendMessage(
    userId: string,
    leadPhoneNumber: string,
    content: string,
  ): Promise<{ whatsappMessageId: string | null }> {
    const sock = await this.waitForActiveSession(userId, 15_000);
    if (!sock) {
      throw new Error('Sessao WhatsApp nao esta ativa.');
    }
    const jid = await this.resolveJid(sock, leadPhoneNumber);
    const sent = await sock.sendMessage(jid, { text: content });
    return { whatsappMessageId: sent?.key?.id ?? null };
  }

  async markAsRead(
    userId: string,
    keys: Array<{ id: string; remoteJid: string; fromMe?: boolean }>,
  ): Promise<void> {
    const sock = await this.waitForActiveSession(userId, 5_000);
    if (!sock || keys.length === 0) return;
    const resolved = await Promise.all(
      keys.map(async (k) => {
        const phone = k.remoteJid.split('@')[0];
        const jid = await this.resolveJid(sock, '+' + phone);
        return { id: k.id, remoteJid: jid, fromMe: k.fromMe ?? false };
      }),
    );
    await sock.readMessages(resolved);
  }

  // -------------------- internos --------------------

  private startLockRenewal(userId: string, lock: AcquiredLock): void {
    const existing = this.lockRenewers.get(userId);
    if (existing) clearInterval(existing);
    const timer = setInterval(async () => {
      const renewed = await this.redisLock.renew(lock, SESSION_LOCK_TTL_MS).catch(() => false);
      if (!renewed) {
        this.logger.warn(`Lock perdido (${userId}) — encerrando socket local`);
        await this.releaseSessionLock(userId);
        const sock = this.sessions.get(userId);
        if (sock) {
          this.sessions.delete(userId);
          try {
            (sock as any).end?.();
          } catch {}
        }
      }
    }, SESSION_LOCK_RENEW_MS);
    this.lockRenewers.set(userId, timer);
  }

  private async releaseSessionLock(userId: string): Promise<void> {
    const timer = this.lockRenewers.get(userId);
    if (timer) {
      clearInterval(timer);
      this.lockRenewers.delete(userId);
    }
    const lock = this.sessionLocks.get(userId);
    if (lock) {
      this.sessionLocks.delete(userId);
      await this.redisLock.release(lock).catch(() => {});
    }
  }

  private async forceResetSession(userId: string, sock: WASocket): Promise<void> {
    this.sessions.delete(userId);
    this.stores.delete(userId);
    await this.releaseSessionLock(userId);
    try {
      await (sock as any).logout?.();
    } catch {
      try {
        (sock as any).end?.(undefined);
      } catch {}
    }
    await this.sessionRepository.delete(userId).catch(() => {});
    await invalidateAuthCache(userId, this.redis);
  }

  private isSocketReady(sock: WASocket): boolean {
    const ws = (sock as any).ws;
    const readyState = ws?.readyState ?? ws?.socket?.readyState;
    return readyState === 1 && !!sock.user;
  }

  private async waitForActiveSession(userId: string, timeoutMs: number): Promise<WASocket | null> {
    const start = Date.now();
    const initial = this.sessions.get(userId);
    if (!initial && !this.pendingSessions.has(userId) && this.sessionLocks.has(userId)) {
      this.startSession(userId).catch(() => {});
    }
    while (Date.now() - start < timeoutMs) {
      const sock = this.sessions.get(userId);
      if (sock && this.isSocketReady(sock)) return sock;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  private isDuplicate(wppId: string | null): boolean {
    if (!wppId) return false;
    const now = Date.now();
    const existing = this.processedMessageIds.get(wppId);
    if (existing && now - existing < MESSAGE_DEDUP_TTL_MS) return true;
    this.processedMessageIds.set(wppId, now);
    if (this.processedMessageIds.size > 5000) {
      for (const [k, ts] of this.processedMessageIds) {
        if (now - ts >= MESSAGE_DEDUP_TTL_MS) {
          this.processedMessageIds.delete(k);
        }
      }
    }
    return false;
  }

  private async handleIncomingMessage(
    userId: string,
    sock: WASocket,
    message: any,
    lidToPhone: Map<string, string>,
  ) {
    const jid = message.key?.remoteJid;
    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter'))
      return;
    if (message.key?.fromMe) return;

    const wppId = (message.key?.id as string | undefined) ?? null;
    const innerMessage = unwrapMessageContent(message.message);
    const isImage = !!innerMessage?.imageMessage;
    const rawText = extractMessageText(innerMessage);
    const messageText = isImage ? rawText || '[Imagem]' : rawText;

    if (!messageText || messageText.trim() === '') {
      const shape = describeMessageShape(message.message);
      if (!shape) {
        this.logger.warn(`Mensagem perdida por falha cripto (wppId: ${wppId}, userId: ${userId})`);
        return;
      }
      this.logger.warn(
        `Mensagem sem texto extraivel (shape: ${shape}, wppId: ${wppId}, userId: ${userId})`,
      );
      return;
    }

    if (this.isDuplicate(wppId)) {
      this.logger.log(`Mensagem duplicada ignorada (${wppId}, ${userId})`);
      return;
    }

    let phoneJid = jid;
    if (jid.endsWith('@lid')) {
      const resolved = message.key?.remoteJidAlt ?? lidToPhone.get(jid);

      if (!resolved || resolved.endsWith('@lid')) {
        this.logger.warn(
          `LID nao resolvido para numero — mensagem ignorada (jid: ${jid}, wppId: ${wppId}, userId: ${userId})`,
        );
        return;
      }
      phoneJid = resolved;
    }
    const rawNumber = phoneJid.split('@')[0];
    if (!rawNumber || !/^\d+$/.test(rawNumber)) return;

    const leadPhoneNumber = normalizeBrazilianPhone('+' + rawNumber);
    if (!/^\+\d{10,15}$/.test(leadPhoneNumber)) {
      this.logger.warn(
        `Numero fora do padrao E.164 — mensagem ignorada (numero: ${leadPhoneNumber}, jid: ${jid}, wppId: ${wppId}, userId: ${userId})`,
      );
      return;
    }
    const botPhoneNumber = sock.user?.id
      ? normalizeBrazilianPhone('+' + sock.user.id.split(':')[0].split('@')[0])
      : '';
    const leadName = message.pushName || null;

    let mediaUrl: string | null = null;
    if (isImage && this.mediaStorage.isEnabled()) {
      try {
        const baileys = await loadBaileys();
        const buffer = (await baileys.downloadMediaMessage(message, 'buffer', {})) as Buffer;
        const mimeType = innerMessage.imageMessage?.mimetype || 'image/jpeg';
        const ext = mimeType.split('/')[1]?.split(';')[0] || 'jpg';
        const path = `${userId}/${wppId ?? Date.now()}.${ext}`;
        mediaUrl = await this.mediaStorage.uploadImage(buffer, path, mimeType);
      } catch (err) {
        this.logger.warn(`Falha upload imagem (${wppId}, ${userId}): ${(err as Error).message}`);
      }
    }
    const mediaType: 'image' | null = isImage && mediaUrl ? 'image' : null;

    this.logger.log(
      `Msg recebida — bot: ${botPhoneNumber} | lead: ${leadPhoneNumber} | texto: "${messageText}"${
        mediaUrl ? ' | midia: image' : ''
      }`,
    );

    await this.events.publishMessageReceived({
      userId,
      whatsappMessageId: wppId,
      botPhoneNumber,
      leadPhoneNumber,
      leadName,
      text: messageText,
      mediaUrl,
      mediaType,
      receivedAt: new Date().toISOString(),
    });
  }

  private async resolveJid(sock: WASocket, phone: string): Promise<string> {
    const cleanPhone = phone.replace('+', '');
    const fallback = cleanPhone + '@s.whatsapp.net';
    try {
      const candidates = brazilianPhoneCandidates(cleanPhone);
      const results = await sock.onWhatsApp(...candidates);
      const found = results?.find((r) => r?.exists);
      if (found?.jid) return found.jid;
    } catch {
      // ignore
    }
    return fallback;
  }
}

function brazilianPhoneCandidates(cleanPhone: string): string[] {
  if (!cleanPhone.startsWith('55')) return [cleanPhone];
  if (cleanPhone.length === 13) {
    return [cleanPhone, cleanPhone.slice(0, 4) + cleanPhone.slice(5)];
  }
  if (cleanPhone.length === 12) {
    return [cleanPhone, cleanPhone.slice(0, 4) + '9' + cleanPhone.slice(4)];
  }
  return [cleanPhone];
}
