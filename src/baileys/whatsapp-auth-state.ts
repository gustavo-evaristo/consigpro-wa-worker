import type { AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import type Redis from 'ioredis';
import { WhatsAppSessionRepository } from '../persistence/whatsapp-session.repository';
import { loadBaileys } from './baileys.loader';

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const cacheKey = (userId: string) => `wa:auth:${userId}`;

interface CachedAuthBlob {
  creds: string;
  keys: string;
}

export async function invalidateAuthCache(userId: string, redis: Redis | null): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(cacheKey(userId));
  } catch {
    // Postgres ja foi limpo — falha do Redis nao deve quebrar.
  }
}

async function loadFromCacheOrDb(
  userId: string,
  repository: WhatsAppSessionRepository,
  redis: Redis | null,
): Promise<CachedAuthBlob | null> {
  if (redis) {
    try {
      const cached = await redis.get(cacheKey(userId));
      if (cached) return JSON.parse(cached) as CachedAuthBlob;
    } catch {
      // ignore
    }
  }
  const stored = await repository.findByUserId(userId);
  if (!stored?.creds) return null;
  const blob: CachedAuthBlob = {
    creds: stored.creds,
    keys: stored.keys ?? '{}',
  };
  if (redis) {
    redis.set(cacheKey(userId), JSON.stringify(blob), 'EX', CACHE_TTL_SECONDS).catch(() => {});
  }
  return blob;
}

export async function useWhatsAppAuthState(
  userId: string,
  repository: WhatsAppSessionRepository,
  redis: Redis | null = null,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const { BufferJSON, initAuthCreds, proto } = await loadBaileys();

  const stored = await loadFromCacheOrDb(userId, repository, redis);

  const creds = stored?.creds ? JSON.parse(stored.creds, BufferJSON.reviver) : initAuthCreds();

  const keys: Record<string, any> = stored?.keys ? JSON.parse(stored.keys, BufferJSON.reviver) : {};

  const persist = async () => {
    const credsStr = JSON.stringify(creds, BufferJSON.replacer);
    const keysStr = JSON.stringify(keys, BufferJSON.replacer);
    await repository.save(userId, credsStr, keysStr);
    if (redis) {
      redis
        .set(
          cacheKey(userId),
          JSON.stringify({ creds: credsStr, keys: keysStr }),
          'EX',
          CACHE_TTL_SECONDS,
        )
        .catch(() => {});
    }
  };

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            let value = keys[`${type}-${id}`];
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value;
          }
          return result;
        },
        set: async (data: any) => {
          for (const category in data) {
            const entries = data[category] as Record<string, any>;
            for (const id in entries) {
              const value = entries[id];
              const key = `${category}-${id}`;
              if (value) keys[key] = value;
              else delete keys[key];
            }
          }
          await persist();
        },
      },
    },
    saveCreds: persist,
  };
}
