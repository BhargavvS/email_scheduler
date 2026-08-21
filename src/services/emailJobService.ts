import type { EmailJob, EmailJobStatus, Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { ValidationError } from '../middleware/error.js';

export const SCHEDULED_STATUSES: EmailJobStatus[] = ['pending', 'queued', 'processing'];
export const SENT_STATUSES: EmailJobStatus[] = ['sent', 'failed'];

export interface ListEmailJobsParams {
  userId: string;
  tab: 'scheduled' | 'sent';
  status?: EmailJobStatus;
  page?: number;
  limit?: number;
  batchId?: string;
  senderId?: string;
}

export interface ListEmailJobsResult {
  data: EmailJob[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function validateStatusForTab(status: EmailJobStatus, tab: 'scheduled' | 'sent'): void {
  const allowed = tab === 'scheduled' ? SCHEDULED_STATUSES : SENT_STATUSES;
  if (!allowed.includes(status)) {
    throw new ValidationError(`status "${status}" is not valid for the "${tab}" tab`, [
      { field: 'status', issue: `must be one of ${allowed.join(', ')} for this tab` },
    ]);
  }
}

/**
 * Lists email_jobs for the given tab, always scoped to the authenticated user
 * via the owning batch. Scheduled = pending/queued/processing (soonest first),
 * Sent = sent/failed (most recent first). The frontend never queries Redis
 * directly — this table is the ground truth. An empty result is still 200 with
 * `data: []`.
 */
export async function listEmailJobs(params: ListEmailJobsParams): Promise<ListEmailJobsResult> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  if (params.status) {
    validateStatusForTab(params.status, params.tab);
  }

  const where: Prisma.EmailJobWhereInput = {
    batch: { userId: params.userId },
    ...(params.batchId ? { batchId: params.batchId } : {}),
    ...(params.senderId ? { senderId: params.senderId } : {}),
  };
  if (params.status) {
    where.status = params.status;
  } else {
    where.status = { in: params.tab === 'scheduled' ? SCHEDULED_STATUSES : SENT_STATUSES };
  }

  const [items, total] = await Promise.all([
    prisma.emailJob.findMany({
      where,
      orderBy:
        params.tab === 'sent'
          ? [{ sentAt: 'desc' }, { scheduledAt: 'desc' }]
          : [{ scheduledAt: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        sender: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.emailJob.count({ where }),
  ]);

  return {
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Fetches a single job, scoped to the authenticated user. Returns null when
 * the job doesn't exist OR belongs to another user — the route reports the
 * same 404 either way so job ids can't be probed for existence.
 */
export async function getEmailJobById(
  userId: string,
  jobId: string,
): Promise<(EmailJob & { sender: { id: string; name: string; email: string } | null }) | null> {
  return prisma.emailJob.findFirst({
    where: {
      id: jobId,
      batch: { userId },
    },
    include: {
      sender: { select: { id: true, name: true, email: true } },
    },
  });
}
