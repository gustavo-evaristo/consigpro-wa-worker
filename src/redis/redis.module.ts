import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { REDIS_BULL, REDIS_PUB, REDIS_SUB } from './redis.constants';
import { RedisLockService } from './redis-lock.service';

function createClient(name: string, url: string): Redis {
  const logger = new Logger(`Redis:${name}`);
  // NAO sobrescrever `tls` aqui — rediss:// na URL ja liga TLS com SNI
  // correto (Upstash exige). Sobrescrever quebrou em producao antes.
  const opts: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  };
  const client = new Redis(url, opts);
  client.on('ready', () => logger.log('connected'));
  client.on('error', (err) => logger.error(`error: ${err.message}`));
  client.on('reconnecting', () => logger.warn('reconnecting'));
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_PUB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const url = config.get<string>('REDIS_URL');
        if (!url) {
          throw new Error(
            'REDIS_URL eh obrigatorio no wa-worker (lock + pub/sub).',
          );
        }
        return createClient('pub', url);
      },
    },
    {
      provide: REDIS_SUB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const url = config.get<string>('REDIS_URL')!;
        return createClient('sub', url);
      },
    },
    {
      provide: REDIS_BULL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const url = config.get<string>('REDIS_URL')!;
        return createClient('bull', url);
      },
    },
    RedisLockService,
  ],
  exports: [REDIS_PUB, REDIS_SUB, REDIS_BULL, RedisLockService],
})
export class RedisModule {}
