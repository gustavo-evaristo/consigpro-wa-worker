import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_PUB } from '../redis/redis.constants';
import {
  WA_EVENT_MESSAGE_RECEIVED,
  WA_EVENT_MESSAGE_STATUS,
  WA_EVENT_QR,
  WA_EVENT_STATUS,
  WaMessageReceivedPayload,
  WaMessageStatusPayload,
  WaQrEventPayload,
  WaStatusEventPayload,
} from './event-channels';

@Injectable()
export class EventPublisherService {
  private readonly logger = new Logger(EventPublisherService.name);

  constructor(@Inject(REDIS_PUB) private readonly redis: Redis) {}

  private async publish<T>(channel: string, payload: T): Promise<void> {
    try {
      await this.redis.publish(channel, JSON.stringify(payload));
    } catch (err) {
      this.logger.warn(`Falha ao publicar ${channel}: ${(err as Error).message}`);
    }
  }

  publishQr(payload: WaQrEventPayload) {
    return this.publish(WA_EVENT_QR, payload);
  }

  publishStatus(payload: WaStatusEventPayload) {
    return this.publish(WA_EVENT_STATUS, payload);
  }

  publishMessageReceived(payload: WaMessageReceivedPayload) {
    return this.publish(WA_EVENT_MESSAGE_RECEIVED, payload);
  }

  publishMessageStatus(payload: WaMessageStatusPayload) {
    return this.publish(WA_EVENT_MESSAGE_STATUS, payload);
  }
}
