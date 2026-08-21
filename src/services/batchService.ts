import crypto from 'node:crypto';

import type { Batch, Prisma } from '@prisma/client';

import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../middleware/error.js';
import { enqueueEmailJobs } from './enqueueService.js';

export interface StoredAttachment {
  name: string;
  contentType: string;
  size: number;
  dataBase64: string;
}

export interface CreateBatchInput {
  userId: string;
  subject: string;
  body: string;
  recipients: string[] | string;
  startTime: Date;
  delayMs: number;
  hourlyLimit?: number;
  senderId?: string;
  fromEmail: string;
  attachments?: StoredAttachment[];
  idempotencyKey?: string;
}

export interface CreateBatchResult {
  batch: Batch;
  validRecipients: number;
  totalRecipients: number;
  invalidEmailsSkipped: number;
  duplicatesRemoved: number;
  firstScheduledAt: Date;
  lastScheduledAt: Date;
  status: 'scheduled' | 'partially_enqueued';
  idempotent: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ParsedRecipients {
  valid: string[];
  invalidSkipped: number;
  duplicatesRemoved: number;
  rawCount: number;
}

/**
 * Accepts either an array of email strings or a single blob (CSV / newline
 * separated). Trims, lowercases, dedupes (silently — duplicates are not an
 * error per spec), and filters out malformed emails.
 */
export function parseRecipients(input: string[] | string): ParsedRecipients {
  const raw: string[] = Array.isArray(input) ? input : input.split(/[\r\n,;]+/);
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalidSkipped = 0;

  for (const entry of raw) {
    const email = entry.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_REGEX.test(email)) {
      invalidSkipped += 1;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push(email);
  }

  const validRaw = raw.length - invalidSkipped;
  return {
    valid,
    invalidSkipped,
    duplicatesRemoved: validRaw - valid.length,
    rawCount: raw.length,
  };
}

/**
 * Deterministic fallback key used when the client does not supply its own
 * `idempotencyKey`, so a double-click submit still collapses into one batch.
 */
export function idempotencyKeyFor(input: {
  userId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
}): string {
  const canonical = [
    input.userId,
    input.subject.trim(),
    input.body.trim(),
    input.recipients.slice().sort().join(','),
    input.startTime.toISOString(),
  ].join('\u0000');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function listSenders(): Promise<{ id: string; name: string; email: string }[]> {
  return prisma.sender.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
}

async function summaryFor(batch: Batch): Promise<CreateBatchResult> {
  const count = await prisma.emailJob.count({ where: { batchId: batch.id } });
  return {
    batch,
    validRecipients: count,
    totalRecipients: count,
    invalidEmailsSkipped: 0,
    duplicatesRemoved: 0,
    firstScheduledAt: batch.startTime,
    lastScheduledAt: new Date(batch.startTime.getTime() + Math.max(0, count - 1) * batch.delayMs),
    status: 'scheduled',
    idempotent: true,
  };
}

/**
 * Creates a batch + one email_jobs row per valid recipient inside a single DB
 * transaction (a nested Prisma create is one transaction), then — only AFTER
 * the commit — enqueues each row to BullMQ. If Redis is down at enqueue time,
 * the rows stay `pending` and the batch is reported as `partially_enqueued`;
 * the B6 reconciliation sweep recovers them later. The client never retries
 * this endpoint on enqueue failure (that would risk a duplicate batch).
 */
export async function createBatch(input: CreateBatchInput): Promise<CreateBatchResult> {
  const { valid, invalidSkipped, duplicatesRemoved, rawCount } = parseRecipients(input.recipients);
  if (valid.length === 0) {
    throw new HttpError(
      422,
      `0 valid emails after filtering ${invalidSkipped} invalid ${invalidSkipped === 1 ? 'entry' : 'entries'}`,
      'ALL_RECIPIENTS_INVALID',
    );
  }

  const resolvedSenderId =
    input.senderId ??
    (await (async (): Promise<string> => {
      const byEmail = await prisma.sender.findFirst({
        where: { email: input.fromEmail },
        select: { id: true },
      });
      if (byEmail) return byEmail.id;
      const fallback = await prisma.sender.findFirst({
        orderBy: { name: 'asc' },
        select: { id: true },
      });
      if (!fallback) {
        throw new HttpError(404, 'No sender configured', 'SENDER_NOT_FOUND');
      }
      return fallback.id;
    })());

  const sender = await prisma.sender.findUnique({ where: { id: resolvedSenderId } });
  if (!sender) {
    throw new HttpError(404, 'Sender not found', 'SENDER_NOT_FOUND');
  }

  const resolvedHourlyLimit =
    input.hourlyLimit ?? sender.maxPerHourOverride ?? env.MAX_EMAILS_PER_HOUR;

  const idempotencyKey =
    input.idempotencyKey ??
    idempotencyKeyFor({
      userId: input.userId,
      subject: input.subject,
      body: input.body,
      recipients: valid,
      startTime: input.startTime,
    });

  const existing = await prisma.batch.findFirst({
    where: {
      idempotencyKey,
      userId: input.userId,
      createdAt: { gte: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) },
    },
  });
  if (existing) {
    return summaryFor(existing);
  }

  const firstScheduledAt = input.startTime;
  const lastScheduledAt = new Date(
    firstScheduledAt.getTime() + Math.max(0, valid.length - 1) * input.delayMs,
  );

  const batch = await prisma.batch.create({
    data: {
      userId: input.userId,
      subject: input.subject,
      body: input.body,
      startTime: firstScheduledAt,
      delayMs: input.delayMs,
      hourlyLimit: resolvedHourlyLimit,
      idempotencyKey,
      emailJobs: {
        create: valid.map((recipient, index) => ({
          senderId: resolvedSenderId,
          recipient,
          subject: input.subject,
          body: input.body,
          fromEmail: input.fromEmail,
          ...(input.attachments && input.attachments.length > 0
            ? { attachments: input.attachments as unknown as Prisma.InputJsonValue }
            : {}),
          scheduledAt: new Date(firstScheduledAt.getTime() + index * input.delayMs),
          status: 'pending' as const,
        })),
      },
    },
    include: { emailJobs: true },
  });

  const { failed } = await enqueueEmailJobs(batch.emailJobs);

  return {
    batch,
    validRecipients: valid.length,
    totalRecipients: rawCount,
    invalidEmailsSkipped: invalidSkipped,
    duplicatesRemoved,
    firstScheduledAt,
    lastScheduledAt,
    status: failed > 0 ? 'partially_enqueued' : 'scheduled',
    idempotent: false,
  };
}
