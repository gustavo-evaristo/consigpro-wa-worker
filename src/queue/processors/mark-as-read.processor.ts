import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SessionManagerService } from '../../baileys/session-manager.service';
import { isWaWorkerActive } from '../../config/feature-flags';
import { MarkAsReadJobData, WA_READ_QUEUE } from '../queue.constants';

@Processor(WA_READ_QUEUE)
export class MarkAsReadProcessor extends WorkerHost {
  private readonly logger = new Logger(MarkAsReadProcessor.name);

  constructor(private readonly sessions: SessionManagerService) {
    super();
  }

  async process(job: Job<MarkAsReadJobData>): Promise<void> {
    if (!isWaWorkerActive()) {
      this.logger.warn(
        `[job:mark-as-read] worker em standby — ignorando read receipt`,
      );
      return;
    }
    const { userId, keys } = job.data;
    this.logger.log(`[job:mark-as-read] userId=${userId} count=${keys.length}`);
    await this.sessions.markAsRead(userId, keys);
  }
}
