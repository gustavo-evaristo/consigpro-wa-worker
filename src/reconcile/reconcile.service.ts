import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SessionManagerService } from '../baileys/session-manager.service';
import { WhatsAppSessionRepository } from '../persistence/whatsapp-session.repository';
import { isWaWorkerActive } from '../config/feature-flags';

@Injectable()
export class ReconcileService implements OnApplicationShutdown {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(
    private readonly sessions: SessionManagerService,
    private readonly repo: WhatsAppSessionRepository,
  ) {}

  /**
   * A cada 30s, varre as sessoes registradas em whatsapp_sessions e tenta
   * reabrir as que nao estao com socket local nem com lock detido. Cobre:
   *
   * - Lock orfao deixado por instancia anterior (TTL expirou, ninguem reivindicou)
   * - Nova sessao foi criada por outro caminho enquanto este worker estava down
   * - Reentrada apos perda transiente do lock
   *
   * Se o lock estiver legitimamente com outra instancia, startSession faz
   * no-op silencioso.
   */
  @Interval(30_000)
  async reconcile(): Promise<void> {
    if (!isWaWorkerActive()) {
      // Wa-worker em standby — nao tenta pegar locks. Bot-api continua dono.
      return;
    }
    try {
      const userIds = await this.repo.findAllUserIds();
      for (const userId of userIds) {
        if (this.sessions.hasLocal(userId)) continue;
        if (this.sessions.isPending(userId)) continue;
        this.sessions.startSession(userId).catch((err) =>
          this.logger.error(`reconcile falhou ${userId}:`, err),
        );
      }
    } catch (err) {
      this.logger.error('reconcile erro:', err);
    }
  }

  async onApplicationShutdown() {
    await this.sessions.stopAll();
  }
}
