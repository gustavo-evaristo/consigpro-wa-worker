import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export interface WhatsAppSessionRecord {
  userId: string;
  creds: string | null;
  keys: string | null;
}

@Injectable()
export class WhatsAppSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<WhatsAppSessionRecord | null> {
    const r = await this.prisma.whatsapp_sessions.findUnique({
      where: { userId },
    });
    if (!r) return null;
    return { userId: r.userId, creds: r.creds, keys: r.keys };
  }

  async save(
    userId: string,
    creds: string,
    keys: string,
  ): Promise<void> {
    await this.prisma.whatsapp_sessions.upsert({
      where: { userId },
      update: { creds, keys, updatedAt: new Date() },
      create: { userId, creds, keys },
    });
  }

  async setConnectionStatus(
    userId: string,
    status: 'CONNECTED' | 'DISCONNECTED' | 'PENDING',
    connectedPhone: string | null,
  ): Promise<void> {
    await this.prisma.whatsapp_sessions.upsert({
      where: { userId },
      update: {
        connectionStatus: status,
        connectedPhone,
        lastSeenAt: status === 'CONNECTED' ? new Date() : undefined,
        updatedAt: new Date(),
      },
      create: {
        userId,
        connectionStatus: status,
        connectedPhone,
      },
    });
  }

  async delete(userId: string): Promise<void> {
    await this.prisma.whatsapp_sessions
      .delete({ where: { userId } })
      .catch(() => {});
  }

  async findAllUserIds(): Promise<string[]> {
    const rows = await this.prisma.whatsapp_sessions.findMany({
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async getConnectedPhone(userId: string): Promise<string | null> {
    const r = await this.prisma.whatsapp_sessions.findUnique({
      where: { userId },
      select: { connectedPhone: true },
    });
    return r?.connectedPhone ?? null;
  }
}
