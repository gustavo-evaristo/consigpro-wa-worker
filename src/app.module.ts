import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { PersistenceModule } from './persistence/persistence.module';
import { BaileysModule } from './baileys/baileys.module';
import { QueueModule } from './queue/queue.module';
import { EventsModule } from './events/events.module';
import { ReconcileModule } from './reconcile/reconcile.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    RedisModule,
    StorageModule,
    PersistenceModule,
    EventsModule,
    BaileysModule,
    QueueModule,
    ReconcileModule,
    HealthModule,
  ],
})
export class AppModule {}
