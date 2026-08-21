import { Redis } from 'ioredis';

import { env } from './env.js';

export function createRedisClient(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
}

/**
 * Opens a throwaway connection, PINGs, then closes. Throws if Redis is
 * unreachable or the PING does not succeed. Safe to call on every /health
 * request — it never hangs the process because the probe client does not
 * auto-reconnect.
 */
export async function pingRedis(url: string): Promise<void> {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null,
  });

  client.on('error', () => {});

  try {
    await client.connect();

    const reply = await client.ping();

    if (reply !== 'PONG') {
      throw new Error(`unexpected PING reply: ${reply}`);
    }
  } finally {
    client.disconnect();
  }
}

export async function checkRedis(url: string): Promise<boolean> {
  try {
    await pingRedis(url);
    return true;
  } catch {
    return false;
  }
}