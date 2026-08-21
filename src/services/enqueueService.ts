import { prisma } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import { withTimeout } from '../lib/withTimeout.js';
import {
  DEFAULT_JOB_OPTIONS,
  SEND_JOB_NAME,
  emailJobIdFor,
  getQueueForSender,
} from '../queues/emailQueue.js';

export interface EnqueueableJob {
  id: string;
  senderId: string | null;
  scheduledAt: Date;
}

export interface EnqueueResult {
  enqueued: number;
  failed: number;
}

const ENQUEUE_TIMEOUT_MS = 3000;

/**
 * Enqueues already-committed email_jobs rows into BullMQ. The DB write happens
 * BEFORE this is called, so a Redis failure here never loses data — the rows
 * stay `pending` and the B6 reconciliation sweep picks them up later.
 *
 * The deterministic jobId (`email-{rowId}`; the spec's `email:{rowId}` is
 * rejected by BullMQ which forbids `:` in custom ids) makes re-adding a job
 * idempotent — BullMQ silently no-ops when that jobId already exists.
 */
export async function enqueueEmailJobs(jobs: EnqueueableJob[]): Promise<EnqueueResult> {
  const outcomes = await Promise.allSettled(
    jobs.map(async (job) => {
      if (!job.senderId) {
        throw new Error('job has no sender');
      }
      const queue = getQueueForSender(job.senderId);
      const delay = Math.max(0, job.scheduledAt.getTime() - Date.now());
      await withTimeout(
        queue.add(
          SEND_JOB_NAME,
          { emailJobId: job.id, senderId: job.senderId },
          { jobId: emailJobIdFor(job.id), delay, ...DEFAULT_JOB_OPTIONS },
        ),
        ENQUEUE_TIMEOUT_MS,
        'queue.add',
      );
      return job.id;
    }),
  );

  const succeededIds: string[] = [];
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') {
      succeededIds.push(outcome.value);
      logger.info({ emailJobId: outcome.value }, 'Enqueued email job');
    } else {
      failed += 1;
      logger.error(
        { err: outcome.reason },
        'Enqueue failed — row stays pending, B6 reconciliation will retry',
      );
    }
  }

  if (succeededIds.length > 0) {
    await prisma.$transaction(
      succeededIds.map((id) =>
        prisma.emailJob.update({
          where: { id },
          data: { status: 'queued', bullmqJobId: emailJobIdFor(id) },
        }),
      ),
    );
  }

  return { enqueued: succeededIds.length, failed };
}
