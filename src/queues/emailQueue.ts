import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { createRedisClient } from '../config/redis.js';

export const EMAIL_QUEUE_PREFIX = 'email-';
export const SEND_JOB_NAME = 'send';

/** BullMQ retry policy applied to every enqueued email job. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: env.SEND_MAX_ATTEMPTS,
  backoff: { type: 'exponential' as const, delay: env.SEND_BACKOFF_MS },
};

const queues = new Map<string, Queue>();
let sharedConnection: Redis | undefined;

function getConnection(): Redis {
  if (!sharedConnection) {
    sharedConnection = createRedisClient();
  }
  return sharedConnection;
}

/**
 * One BullMQ queue per sender. A queue-level `limiter` (added in B5) then
 * naturally paces each sender independently without a hand-rolled global lock.
 * The queue is created lazily and cached for the life of the process.
 */
export function getQueueForSender(senderId: string): Queue {
  const cached = queues.get(senderId);
  if (cached) return cached;

  const queue = new Queue(EMAIL_QUEUE_PREFIX + senderId, { connection: getConnection() });
  queues.set(senderId, queue);
  return queue;
}

export function senderIdFromQueueName(queueName: string): string {
  return queueName.startsWith(EMAIL_QUEUE_PREFIX)
    ? queueName.slice(EMAIL_QUEUE_PREFIX.length)
    : queueName;
}

/**
 * Closes the lazily-created shared Redis connection. Used by short-lived
 * processes (the manual `npm run reconcile` script) so they can exit cleanly;
 * the long-lived API/worker processes leave it open for the life of the process.
 */
export async function closeQueueConnections(): Promise<void> {
  const conn = sharedConnection;
  sharedConnection = undefined;
  if (conn) await conn.quit();
}

/**
 * Deterministic BullMQ jobId for an email_jobs row. BullMQ rejects `:` in
 * custom ids, so we use a hyphen. Being derivable purely from the row id is
 * what makes re-adding a job idempotent (B6 reconciliation relies on it).
 */
export function emailJobIdFor(emailJobRowId: string): string {
  return `email-${emailJobRowId}`;
}
