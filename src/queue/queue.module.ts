import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WA_MESSAGE_QUEUE, WA_READ_QUEUE, WA_SESSION_QUEUE } from './queue.constants';
import { StartSessionProcessor } from './processors/start-session.processor';
import { SendMessageProcessor } from './processors/send-message.processor';
import { MarkAsReadProcessor } from './processors/mark-as-read.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        if (!url) {
          throw new Error('REDIS_URL eh obrigatorio para BullMQ.');
        }
        // Compartilha a conexao mas BullMQ exige maxRetriesPerRequest=null
        return {
          connection: {
            url,
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: WA_SESSION_QUEUE },
      { name: WA_MESSAGE_QUEUE },
      { name: WA_READ_QUEUE },
    ),
  ],
  providers: [StartSessionProcessor, SendMessageProcessor, MarkAsReadProcessor],
})
export class QueueModule {}
