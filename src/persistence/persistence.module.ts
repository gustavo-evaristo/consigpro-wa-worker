import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { WhatsAppSessionRepository } from './whatsapp-session.repository';

@Global()
@Module({
  providers: [PrismaService, WhatsAppSessionRepository],
  exports: [PrismaService, WhatsAppSessionRepository],
})
export class PersistenceModule {}
