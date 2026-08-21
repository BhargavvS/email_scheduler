import { Router } from 'express';
import { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { checkRedis } from '../config/redis.js';
import { checkPostgres } from '../db/pool.js';

const router = Router();

async function checkWorker(): Promise<boolean> {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    commandTimeout: 1500,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    const val = await client.get('worker:heartbeat');
    if (!val) return false;
    const ageMs = Date.now() - Number(val);
    return ageMs < 90000;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

router.get('/', async (_req, res) => {
  const [db, redis, worker] = await Promise.all([
    checkPostgres(env.DATABASE_URL),
    checkRedis(env.REDIS_URL),
    checkWorker(),
  ]);
  const ok = db && redis;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db: db ? 'ok' : 'error',
    redis: redis ? 'ok' : 'error',
    worker: worker ? 'ok' : 'stale',
  });
});

export default router;