import type { Batch, Sender } from '@prisma/client';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createRedisClient } from '../config/redis.js';
import { prisma } from '../db/prisma.js';
import { etherealPreviewUrl, getTransporter } from '../lib/mailer.js';
import { EMAIL_QUEUE_PREFIX } from '../queues/emailQueue.js';
import { checkAndReserveSlot, hourBucket } from '../services/rateLimiter.js';
import {
  runReconciliation,
  startReconciliationSweep,
  stopReconciliationSweep,
} from '../services/reconcileService.js';

interface SendJobData {
  emailJobId: string;
  senderId: string;
}

const REDIS_UNAVAILABLE_RETRY_MS = 30_000;
const RESCHED_KEY_TTL_SECONDS = 3700;

const sendersById = new Map<string, Sender>();

function startOfNextHour(now: number): number {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.getTime();
}

/**
 * Rate-limit hit → defer, don't fail. Cap hits stagger from the next hour
 * boundary using a per-batch counter so the batch's original relative order is
 * preserved (the 6th, 7th, 8th… blocked jobs keep their spacing, just shifted
 * later). Redis-unavailable failures defer by a short fixed delay instead.
 */
async function deferJob(
  job: Job<SendJobData>,
  token: string | undefined,
  rowId: string,
  batch: Batch | null,
  rateLimitRedis: Redis,
  blockedBy: 'global' | 'sender' | 'batch' | 'redis_unavailable',
): Promise<void> {
  const now = Date.now();
  const bucket = hourBucket(new Date(now));

  let newDelayMs: number;
  if (blockedBy === 'redis_unavailable') {
    newDelayMs = REDIS_UNAVAILABLE_RETRY_MS;
  } else {
    const nextHour = startOfNextHour(now);
    let staggerMs = 0;
    if (batch) {
      const reschedKey = `resched:${batch.id}:${bucket}`;
      const staggerIndex = await rateLimitRedis.incr(reschedKey);
      await rateLimitRedis.expire(reschedKey, RESCHED_KEY_TTL_SECONDS);
      staggerMs = (staggerIndex - 1) * batch.delayMs;
    }
    newDelayMs = Math.max(0, nextHour - now) + staggerMs;
  }

  const newScheduledAt = new Date(now + newDelayMs);
  // moveToDelayed (not changeDelay): the job is `active` while the processor
  // runs, and changeDelay only works on delayed jobs. moveToDelayed re-queues
  // it with skipAttempt so deferrals never consume a send attempt.
  // BullMQ v6 requires the lock token; gracefully handle missing token.
  try {
    await job.moveToDelayed(newScheduledAt.getTime(), token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Missing lock token') || msg.includes('Lock not found')) {
      logger.warn({ emailJobId: rowId, msg }, 'moveToDelayed without token, retrying bare');
      await job.moveToDelayed(newScheduledAt.getTime());
    } else {
      throw err;
    }
  }
  await prisma.emailJob.update({
    where: { id: rowId },
    data: { scheduledAt: newScheduledAt, rescheduleCount: { increment: 1 } },
  });
  logger.warn(
    { emailJobId: rowId, blockedBy, newDelayMs, rescheduledAt: newScheduledAt.toISOString() },
    'Job deferred (rate limit)',
  );
}

async function processJob(job: Job<SendJobData>, token?: string): Promise<void> {
  const { emailJobId } = job.data;

  // Fresh DB read, not stale in-memory job data — this is the idempotency
  // guard that makes redelivery, reconciliation replay, and manual retries safe.
  const row = await prisma.emailJob.findUnique({ where: { id: emailJobId } });
  if (!row) {
    logger.warn({ emailJobId }, 'Email job row missing — skipping');
    return;
  }
  if (row.status === 'sent') {
    logger.info({ emailJobId }, 'Already sent — idempotency guard, skipping');
    return;
  }
  if (!row.senderId) {
    logger.warn({ emailJobId }, 'Job has no sender — marking failed');
    await prisma.emailJob.update({
      where: { id: row.id },
      data: { status: 'failed', error: 'no sender assigned' },
    });
    return;
  }

  const [sender, batch] = await Promise.all([
    sendersById.get(row.senderId) ?? prisma.sender.findUnique({ where: { id: row.senderId } }),
    prisma.batch.findUnique({ where: { id: row.batchId } }),
  ]);

  const { allowed, blockedBy } = await checkAndReserveSlot(
    rateLimitRedis,
    row.senderId,
    row.batchId,
  );
  if (!allowed) {
    await deferJob(job, token, row.id, batch, rateLimitRedis, blockedBy ?? 'redis_unavailable');
    return;
  }

  // Re-check after the rate-limit round-trip: another worker could have sent
  // this row while we were waiting.
  const latest = await prisma.emailJob.findUnique({ where: { id: row.id } });
  if (!latest || latest.status === 'sent') return;

  await prisma.emailJob.update({
    where: { id: row.id },
    data: { status: 'processing', attempts: { increment: 1 } },
  });

  try {
    if (!sender) throw new Error('sender not found');
    const transporter = getTransporter(sender.id, sender.smtpConfig);
    const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
    if (Array.isArray(row.attachments)) {
      for (const a of row.attachments as { name: string; contentType: string; dataBase64: string }[]) {
        if (!a || typeof a.dataBase64 !== 'string') continue;
        attachments.push({
          filename: a.name ?? 'attachment',
          contentType: a.contentType ?? 'application/octet-stream',
          content: Buffer.from(a.dataBase64, 'base64'),
        });
      }
    }
    const info = await transporter.sendMail({
      from: row.fromEmail ?? sender.email,
      to: row.recipient,
      subject: row.subject,
      html: row.body,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    await prisma.emailJob.update({
      where: { id: row.id },
      data: { status: 'sent', sentAt: new Date(), previewUrl: etherealPreviewUrl(info) },
    });
    logger.info({ emailJobId: row.id, recipient: row.recipient }, 'Email sent');
  } catch (err) {
    // Rethrow so BullMQ's own retry/backoff handles it. The `failed` event
    // marks the row failed only once attempts are exhausted.
    logger.error(
      { err, emailJobId: row.id, attemptsMade: job.attemptsMade, maxAttempts: job.opts.attempts },
      'Send failed — retrying via BullMQ',
    );
    throw err;
  }
}

function createWorker(sender: Sender): Worker<SendJobData> {
  const worker = new Worker<SendJobData>(EMAIL_QUEUE_PREFIX + sender.id, processJob, {
    connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
    concurrency: env.WORKER_CONCURRENCY,
    limiter: { max: 1, duration: env.MIN_DELAY_MS_BETWEEN_EMAILS },
    maxStalledCount: 2,
  });

  worker.on('failed', (job, err) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? env.SEND_MAX_ATTEMPTS;
    if (job.attemptsMade >= maxAttempts) {
      prisma.emailJob
        .update({
          where: { id: job.data.emailJobId },
          data: { status: 'failed', error: err.message },
        })
        .then(() =>
          logger.warn(
            { emailJobId: job.data.emailJobId, error: err.message, attemptsMade: job.attemptsMade },
            'Job permanently failed after retries',
          ),
        )
        .catch((updateErr: unknown) =>
          logger.error(
            { err: updateErr, emailJobId: job.data.emailJobId },
            'Failed to record job failure',
          ),
        );
    }
  });

  worker.on('error', (err) => logger.error({ err, senderId: sender.id }, 'Worker error'));
  worker.on('completed', (job) =>
    logger.info({ emailJobId: job.data.emailJobId }, 'Job completed'),
  );

  return worker;
}

const rateLimitRedis = createRedisClient();
const workers: Worker[] = [];
let heartbeatTimer: NodeJS.Timeout | undefined;

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  const heartbeat = async () => {
    try {
      await rateLimitRedis.set('worker:heartbeat', String(Date.now()), 'EX', 90);
    } catch {
      // best-effort
    }
  };
  void heartbeat();
  heartbeatTimer = setInterval(heartbeat, 30000);
  heartbeatTimer.unref();
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

async function main(): Promise<void> {
  const senders = await prisma.sender.findMany();
  if (senders.length === 0) {
    logger.fatal('No senders found — run npm run db:seed first');
    process.exit(1);
  }
  for (const sender of senders) sendersById.set(sender.id, sender);

  for (const sender of senders) {
    workers.push(createWorker(sender));
    logger.info(
      {
        senderId: sender.id,
        queue: EMAIL_QUEUE_PREFIX + sender.id,
        concurrency: env.WORKER_CONCURRENCY,
      },
      'Worker started',
    );
  }
  logger.info(
    {
      senders: senders.length,
      concurrency: env.WORKER_CONCURRENCY,
      minDelayMs: env.MIN_DELAY_MS_BETWEEN_EMAILS,
    },
    'Email worker ready',
  );

  startHeartbeat();

  // B6: startup reconciliation first — recover rows that were left pending by
  // a failed enqueue, rows whose Redis jobs vanished, and rows stuck in
  // processing after a crash. Workers are up already so recovered jobs send
  // immediately; deterministic job ids make this safe to run against a live
  // queue. Then start the periodic housekeeping sweep.
  await runReconciliation();
  startReconciliationSweep();

  // New senders added later require a worker restart to pick up — documented
  // assignment-scope shortcut (no dynamic hot-reloading).
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down worker');
  stopReconciliationSweep();
  stopHeartbeat();
  await Promise.all(workers.map((w) => w.close()));
  try {
    await rateLimitRedis.del('worker:heartbeat');
  } catch {
    // ignore
  }
  await rateLimitRedis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  shutdown('uncaughtException').catch(() => process.exit(1));
});
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
