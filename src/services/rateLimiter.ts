import type { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { withTimeout } from '../lib/withTimeout.js';

export type RateLimitBlockedBy = 'global' | 'sender' | 'batch' | 'redis_unavailable';

export interface RateLimitResult {
  allowed: boolean;
  blockedBy?: RateLimitBlockedBy;
}

/** Keys self-expire a little past the hour so there's no clock-skew gap. */
const RATE_LIMIT_TTL_SECONDS = 3700;
const CHECK_TIMEOUT_MS = 3000;

/**
 * Atomic 3-cap reservation. Reads all counters first and only INCRs any of
 * them if every counter is still under its cap — so a blocked request leaves
 * no partial state. Returns `{1, 'ok'}` on success, `{0, 'blocked-cap'}` when
 * a cap would be exceeded.
 */
const RESERVE_SCRIPT = `
local g = tonumber(redis.call('GET', KEYS[1]) or '0')
local s = tonumber(redis.call('GET', KEYS[2]) or '0')
local b = tonumber(redis.call('GET', KEYS[3]) or '0')
if g + 1 > tonumber(ARGV[1]) then return {0, 'global'} end
if s + 1 > tonumber(ARGV[2]) then return {0, 'sender'} end
if b + 1 > tonumber(ARGV[3]) then return {0, 'batch'} end
redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], ARGV[4])
redis.call('INCR', KEYS[3]); redis.call('EXPIRE', KEYS[3], ARGV[4])
return {1, 'ok'}
`;

/** UTC hour bucket: `YYYY-MM-DDTHH`. Shared by all three counters. */
export function hourBucket(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13);
}

/**
 * Checks and reserves one send slot against the global, per-sender, and
 * per-batch caps in a single atomic Redis operation.
 *
 * Limits resolve as: global = MAX_EMAILS_PER_HOUR; sender =
 * sender.max_per_hour_override ?? MAX_EMAILS_PER_HOUR_PER_SENDER; batch = the
 * batch's stored hourly_limit.
 *
 * Fail-closed: if Redis is unreachable or the script errors, no slot is
 * reserved and `blockedBy` is `redis_unavailable` — the worker defers the job
 * instead of sending (RATE_LIMIT_REDIS_FAIL_MODE=closed; never blow through a
 * configured cap because the limiter was down).
 */
export async function checkAndReserveSlot(
  redis: Redis,
  senderId: string,
  batchId: string,
): Promise<RateLimitResult> {
  const [sender, batch] = await Promise.all([
    prisma.sender.findUnique({ where: { id: senderId } }),
    prisma.batch.findUnique({ where: { id: batchId } }),
  ]);

  const globalLimit = env.MAX_EMAILS_PER_HOUR;
  const senderLimit = sender?.maxPerHourOverride ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const batchLimit = batch?.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR;

  const bucket = hourBucket();
  const keys = [
    `rl:global:${bucket}`,
    `rl:sender:${senderId}:${bucket}`,
    `rl:batch:${batchId}:${bucket}`,
  ];

  try {
    const [allowed, blockedBy] = (await withTimeout(
      redis.eval(
        RESERVE_SCRIPT,
        keys.length,
        keys[0]!,
        keys[1]!,
        keys[2]!,
        String(globalLimit),
        String(senderLimit),
        String(batchLimit),
        String(RATE_LIMIT_TTL_SECONDS),
      ),
      CHECK_TIMEOUT_MS,
      'rate-limit reserve',
    )) as [number, string];

    if (allowed === 1) return { allowed: true };
    logger.warn(
      { senderId, batchId, blockedBy },
      'Rate-limit cap reached — no slot reserved, job will be deferred',
    );
    return {
      allowed: false,
      blockedBy: blockedBy as Exclude<RateLimitBlockedBy, 'redis_unavailable'>,
    };
  } catch (err) {
    logger.error(
      { err, senderId, batchId },
      'Rate-limit check failed — failing closed (no slot reserved, job deferred)',
    );
    return { allowed: false, blockedBy: 'redis_unavailable' };
  }
}
