import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SessionManagerService } from '../../baileys/session-manager.service';
import { isWaWorkerActive } from '../../config/feature-flags';
import { StartSessionJobData, WA_SESSION_QUEUE } from '../queue.constants';

@Processor(WA_SESSION_QUEUE)
export class StartSessionProcessor extends WorkerHost {
  private readonly logger = new Logger(StartSessionProcessor.name);

  constructor(private readonly sessions: SessionManagerService) {
    super();
  }

  async process(job: Job<StartSessionJobData>): Promise<void> {
    if (!isWaWorkerActive()) {
      this.logger.warn(
        `[job:start-session] worker em standby (WA_WORKER_ACTIVE=false) — ignorando`,
      );
      return;
    }
    const { userId, targetPhoneNumber } = job.data;
    this.logger.log(
      `[job:start-session] userId=${userId} phone=${targetPhoneNumber ?? '-'}`,
    );
    await this.sessions.startSession(userId, targetPhoneNumber ?? null);
  }
}
