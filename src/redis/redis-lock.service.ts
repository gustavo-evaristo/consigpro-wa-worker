import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS_PUB } from './redis.constants';

const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export interface AcquiredLock {
  key: string;
  token: string;
}

@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(@Inject(REDIS_PUB) private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<AcquiredLock | null> {
    const token = randomUUID();
    const ok = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    if (ok === 'OK') return { key, token };
    return null;
  }

  async renew(lock: AcquiredLock, ttlMs: number): Promise<boolean> {
    const res = (await this.redis.eval(
      RENEW_SCRIPT,
      1,
      lock.key,
      lock.token,
      String(ttlMs),
    )) as number;
    return res === 1;
  }

  async release(lock: AcquiredLock): Promise<void> {
    try {
      await this.redis.eval(RELEASE_SCRIPT, 1, lock.key, lock.token);
    } catch (err) {
      this.logger.warn(`Falha ao liberar lock ${lock.key}: ${(err as Error).message}`);
    }
  }
}
