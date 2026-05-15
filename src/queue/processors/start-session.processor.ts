import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SessionManagerService } from '../../baileys/session-manager.service';
import { StartSessionJobData, WA_SESSION_QUEUE } from '../queue.constants';

@Processor(WA_SESSION_QUEUE)
export class StartSessionProcessor extends WorkerHost {
  private readonly logger = new Logger(StartSessionProcessor.name);

  constructor(private readonly sessions: SessionManagerService) {
    super();
  }

  async process(job: Job<StartSessionJobData>): Promise<void> {
    const { userId, targetPhoneNumber } = job.data;
    this.logger.log(
      `[job:start-session] userId=${userId} phone=${targetPhoneNumber ?? '-'}`,
    );
    await this.sessions.startSession(userId, targetPhoneNumber ?? null);
  }
}
