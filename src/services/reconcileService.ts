import { prisma } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { checkRedis } from '../config/redis.js';
import { withTimeout } from '../lib/withTimeout.js';
import { emailJobIdFor, getQueueForSender } from '../queues/emailQueue.js';
import { enqueueEmailJobs } from './enqueueService.js';

const JOB_STATE_TIMEOUT_MS = 3000;

export interface ReconcileSummary {
  /** Redis reachable at sweep time (the sweep is skipped, not partial, if not). */
  redisUp: boolean;
  /** pending rows found in the DB — the B4 gap (never enqueued). */
  pendingFound: number;
  pendingEnqueued: number;
  /** queued rows whose BullMQ job could be inspected in Redis. */
  queuedChecked: number;
  /** queued rows whose BullMQ job no longer exists → re-enqueued. */
  queuedMissingEnqueued: number;
  /** queued rows still present in Redis → left alone. */
  queuedPresent: number;
  /** processing rows older than the threshold — the B5 crash gap. */
  stuckProcessingFound: number;
  /** stuck rows reset to queued + re-enqueued. */
  stuckRequeued: number;
}

/**
 * Checks whether the deterministic BullMQ job for an email_jobs row still
 * exists in Redis. `getJobState` returns 'unknown' for a missing job (it is a
 * cheap EXISTS-style lookup, not a full job fetch). Fails-closed: if Redis is
 * unreachable this returns `null` so the caller knows the answer is unknown.
 */
async function jobExistsInRedis(senderId: string, jobId: string): Promise<boolean | null> {
  try {
    const queue = getQueueForSender(senderId);
    const state = await withTimeout(
      queue.getJobState(jobId),
      JOB_STATE_TIMEOUT_MS,
      `getJobState ${jobId}`,
    );
    return state !== 'unknown';
  } catch (err) {
    logger.error({ err, senderId, jobId }, 'Reconciliation: could not inspect job in Redis');
    return null;
  }
}

/**
 * B6.1 — pending rows were committed to Postgres but never enqueued (Redis was
 * down at B4 enqueue time, or the API crashed between commit and enqueue).
 * The DB is ground truth, so just (re)enqueue them now. Deterministic job ids
 * make this idempotent even if a row is somehow already present in Redis.
 */
async function reconcilePending(summary: ReconcileSummary): Promise<void> {
  const rows = await prisma.emailJob.findMany({
    where: { status: 'pending' },
    select: { id: true, senderId: true, scheduledAt: true },
  });
  summary.pendingFound = rows.length;
  if (rows.length === 0) return;

  const enqueuable = rows.filter((r) => r.senderId !== null);
  const orphaned = rows.length - enqueuable.length;
  if (orphaned > 0) {
    logger.warn(
      { orphaned },
      'Reconciliation: pending rows have no sender and cannot be enqueued',
    );
  }
  const { enqueued } = await enqueueEmailJobs(enqueuable);
  summary.pendingEnqueued = enqueued;
  logger.info(
    { pendingFound: rows.length, pendingEnqueued: enqueued },
    'Reconciliation: recovered pending (never-enqueued) rows',
  );
}

/**
 * B6.1 — queued rows are the Redis-data-loss case: Postgres believes the job
 * was handed to BullMQ, but Redis lost the record (volume misconfigured,
 * container recreated without the volume). Verify each row's BullMQ job really
 * exists; re-enqueue the ones that vanished.
 * Also handles overdue delayed jobs: if a job's scheduledAt is in the past but
 * its BullMQ state is still `delayed` (worker was down when it became due),
 * promote it to immediate execution by re-adding with delay=0.
 */
async function reconcileQueued(summary: ReconcileSummary): Promise<void> {
  const rows = await prisma.emailJob.findMany({
    where: { status: 'queued', senderId: { not: null } },
    select: { id: true, senderId: true, scheduledAt: true },
  });
  summary.queuedChecked = rows.length;

  const missing: (typeof rows)[number][] = [];
  const overdue: (typeof rows)[number][] = [];
  let present = 0;
  const now = Date.now();
  for (const row of rows) {
    const exists = await jobExistsInRedis(row.senderId as string, emailJobIdFor(row.id));
    if (exists === null) {
      // Redis flaked mid-sweep — leave the row untouched and stop checking;
      // the next sweep (or a manual run) will re-attempt it.
      summary.queuedChecked -= 1;
      break;
    }
    if (!exists) {
      missing.push(row);
      continue;
    }
    // Job exists — but if it's delayed and already overdue, it should have fired.
    // This happens when the worker was down during the scheduled time.
    // BullMQ will promote overdue delayed jobs when the worker restarts, but
    // the 2s per-sender limiter can still cause 10-30s drift for a batch.
    // We actively promote overdue jobs by re-adding with delay=0.
    if (row.scheduledAt.getTime() < now - 5000) {
      try {
        const queue = getQueueForSender(row.senderId as string);
        const state = await withTimeout(
          queue.getJobState(emailJobIdFor(row.id)),
          JOB_STATE_TIMEOUT_MS,
          `getJobState overdue ${row.id}`,
        );
        if (state === 'delayed') {
          overdue.push({ ...row, scheduledAt: new Date() } as typeof row);
          continue;
        }
      } catch {
        // ignore, treat as present
      }
    }
    present += 1;
  }
  summary.queuedPresent = present;

  if (overdue.length > 0) {
    const { enqueued } = await enqueueEmailJobs(overdue);
    logger.warn(
      { overdue: overdue.length, enqueued },
      'Reconciliation: promoted overdue delayed jobs to immediate',
    );
    // overdue jobs are counted as present after promotion attempt
    summary.queuedPresent += overdue.length;
  }

  if (missing.length === 0) {
    if (present > 0 || overdue.length > 0) {
      logger.debug(
        { queuedPresent: present, overduePromoted: overdue.length },
        'Reconciliation: queued rows checked',
      );
    }
    return;
  }

  const { enqueued } = await enqueueEmailJobs(missing);
  summary.queuedMissingEnqueued = enqueued;
  logger.warn(
    { missing: missing.length, enqueued },
    'Reconciliation: re-enqueued queued rows whose Redis jobs were lost',
  );
}

/**
 * B6.2 — a row stuck in `processing` past the threshold means a worker almost
 * certainly died mid-send (between marking the row `processing` and the
 * `sent`/`failed` write). Reset it to `queued` and, if its BullMQ job is gone
 * too, re-enqueue it. When the job still exists in Redis, BullMQ's own stalled
 * recovery will re-deliver it; we only repair the DB side so the row is no
 * longer parked in limbo.
 */
async function reconcileStuckProcessing(summary: ReconcileSummary): Promise<void> {
  const thresholdMs = env.STUCK_PROCESSING_THRESHOLD_MS;
  const staleBefore = new Date(Date.now() - thresholdMs);
  const rows = await prisma.emailJob.findMany({
    where: { status: 'processing', updatedAt: { lt: staleBefore } },
    select: { id: true, senderId: true, scheduledAt: true },
  });
  summary.stuckProcessingFound = rows.length;
  if (rows.length === 0) return;

  logger.warn(
    { stuck: rows.length, thresholdMs },
    'Reconciliation: found stuck processing rows — resetting to queued',
  );

  const requeue: (typeof rows)[number][] = [];
  for (const row of rows) {
    await prisma.emailJob.update({
      where: { id: row.id },
      data: { status: 'queued' },
    });
    if (!row.senderId) continue;
    const exists = await jobExistsInRedis(row.senderId, emailJobIdFor(row.id));
    if (exists === null || !exists) requeue.push(row);
  }

  if (requeue.length > 0) {
    const { enqueued } = await enqueueEmailJobs(requeue);
    summary.stuckRequeued = enqueued;
  }
  logger.warn(
    { reset: rows.length, requeued: requeue.length },
    'Reconciliation: stuck processing rows recovered',
  );
}

/**
 * Runs one full reconciliation pass: pending → enqueue, queued → verify +
 * repair Redis-data-loss, processing-past-threshold → reset + re-enqueue.
 * Fail-closed: if Redis is unreachable the whole pass is skipped (logged) so
 * it can never half-repair state or mark things wrongly.
 */
export async function runReconciliation(): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    redisUp: false,
    pendingFound: 0,
    pendingEnqueued: 0,
    queuedChecked: 0,
    queuedMissingEnqueued: 0,
    queuedPresent: 0,
    stuckProcessingFound: 0,
    stuckRequeued: 0,
  };

  try {
    summary.redisUp = await checkRedis(env.REDIS_URL);
  } catch {
    summary.redisUp = false;
  }

  if (!summary.redisUp) {
    logger.warn('Reconciliation skipped — Redis unreachable (will retry next sweep)');
    return summary;
  }

  await reconcilePending(summary);
  await reconcileQueued(summary);
  await reconcileStuckProcessing(summary);

  logger.info({ summary }, 'Reconciliation complete');
  return summary;
}

let sweepTimer: NodeJS.Timeout | undefined;

/**
 * B6.2 — schedules the periodic reconciliation sweep. This interval is
 * housekeeping, not a cron: it never decides when an email sends (BullMQ's
 * delayed jobs own that). It only repairs rows whose DB state and Redis state
 * disagree — gaps a restart or Redis data loss would otherwise leave forever.
 */
export function startReconciliationSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    runReconciliation().catch((err) =>
      logger.error({ err }, 'Reconciliation sweep failed'),
    );
  }, env.RECONCILE_SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  logger.info(
    { intervalMs: env.RECONCILE_SWEEP_INTERVAL_MS },
    'Reconciliation sweep scheduled',
  );
}

export function stopReconciliationSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
}