import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SessionManagerService } from '../../baileys/session-manager.service';
import { isWaWorkerActive } from '../../config/feature-flags';
import { SendMessageJobData, SendMessageJobResult, WA_MESSAGE_QUEUE } from '../queue.constants';

@Processor(WA_MESSAGE_QUEUE)
export class SendMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(SendMessageProcessor.name);

  constructor(private readonly sessions: SessionManagerService) {
    super();
  }

  async process(job: Job<SendMessageJobData>): Promise<SendMessageJobResult> {
    if (!isWaWorkerActive()) {
      throw new Error('wa-worker em standby (WA_WORKER_ACTIVE=false)');
    }
    const { userId, leadPhoneNumber, content, correlationId } = job.data;
    const { whatsappMessageId } = await this.sessions.sendMessage(userId, leadPhoneNumber, content);
    this.logger.log(
      `[job:send-message] userId=${userId} -> ${leadPhoneNumber} wppId=${whatsappMessageId}`,
    );
    return { whatsappMessageId, correlationId };
  }
}
