import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { env } from '../config/env.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '../middleware/error.js';
import {
  createBatch,
  listSenders,
  type StoredAttachment,
} from '../services/batchService.js';
import { getEmailJobById, listEmailJobs } from '../services/emailJobService.js';

const router = Router();

router.use(requireAuth);

const createBatchSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, 'Subject is required')
    .max(200, 'Subject must be at most 200 characters'),
  body: z.string().min(1, 'Body is required').max(50_000, 'Body must be at most 50000 characters'),
  senderId: z.string().min(1, 'senderId is required').optional(),
  recipients: z.union([
    z.array(z.string().min(1)).min(1).max(env.MAX_RECIPIENTS_PER_BATCH),
    z.string().min(1),
  ]),
  startTime: z.string().datetime({
    offset: true,
    message: 'startTime must be an ISO 8601 datetime',
  }),
  delayMs: z.coerce
    .number({ message: 'delayMs must be a number' })
    .int('delayMs must be an integer')
    .min(1, 'delayMs must be at least 1')
    .max(
      env.MAX_DELAY_MS_BETWEEN_EMAILS,
      `delayMs must be at most ${env.MAX_DELAY_MS_BETWEEN_EMAILS}`,
    ),
  hourlyLimit: z.coerce
    .number({ message: 'hourlyLimit must be a number' })
    .int('hourlyLimit must be an integer')
    .positive('hourlyLimit must be a positive integer')
    .optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'queued', 'processing', 'sent', 'failed']).optional(),
  batchId: z.string().min(1).optional(),
  senderId: z.string().min(1).optional(),
});

const allowedTypeSet = new Set(env.ALLOWED_ATTACHMENT_TYPES);

function validateAttachments(
  attachments: StoredAttachment[],
): StoredAttachment[] {
  if (attachments.length === 0) return attachments;
  if (attachments.length > env.MAX_ATTACHMENTS_PER_EMAIL) {
    throw new ValidationError(
      `Too many attachments. Maximum is ${env.MAX_ATTACHMENTS_PER_EMAIL}.`,
      [{ field: 'attachments', issue: `maximum ${env.MAX_ATTACHMENTS_PER_EMAIL} files allowed` }],
    );
  }
  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
  if (totalSize > env.MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
    throw new ValidationError(
      `Attachments exceed the total size limit of ${env.MAX_TOTAL_ATTACHMENT_SIZE_BYTES} bytes.`,
      [{ field: 'attachments', issue: 'combined attachment size exceeds the limit' }],
    );
  }
  for (const attachment of attachments) {
    if (attachment.size > env.MAX_ATTACHMENT_SIZE_BYTES) {
      throw new ValidationError(
        `"${attachment.name}" exceeds the ${env.MAX_ATTACHMENT_SIZE_BYTES}-byte per-file limit.`,
        [{ field: 'attachments', issue: `"${attachment.name}" is too large` }],
      );
    }
    if (!allowedTypeSet.has(attachment.contentType.toLowerCase())) {
      throw new ValidationError(
        `"${attachment.name}" has an unsupported file type (${attachment.contentType}).`,
        [{ field: 'attachments', issue: `"${attachment.name}" has an unsupported file type` }],
      );
    }
  }
  return attachments;
}

function multipartAttachments(files: Express.Multer.File[]): StoredAttachment[] {
  return files.map((file) => ({
    name: file.originalname,
    contentType: file.mimetype,
    size: file.size,
    dataBase64: file.buffer.toString('base64'),
  }));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: env.MAX_ATTACHMENTS_PER_EMAIL,
    fileSize: env.MAX_ATTACHMENT_SIZE_BYTES,
  },
});

function parseMultipartRecipients(value: unknown): string[] | string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('recipients is required', [
      { field: 'recipients', issue: 'required' },
    ]);
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((r) => String(r)).filter((r) => r.length > 0);
    } catch {
      // fall through to blob handling below
    }
  }
  return trimmed;
}

// POST /api/batches — create a batch + one email_jobs row per valid recipient,
// then enqueue each row to BullMQ after the transaction commits (phase B4).
// Accepts both JSON and multipart/form-data (with an `attachments` file field).
// `senderId` is optional: when omitted the service resolves a transport sender
// for the authenticated user. The `from` address is always the authenticated
// user's email, never an invented value.
router.post(
  '/batches',
  upload.array('attachments', env.MAX_ATTACHMENTS_PER_EMAIL),
  asyncHandler(async (req, res) => {
    const isMultipart = req.is('multipart/form-data');

    const input = isMultipart
      ? {
          subject: req.body.subject,
          body: req.body.body,
          senderId: req.body.senderId ?? undefined,
          recipients: parseMultipartRecipients(req.body.recipients),
          startTime: req.body.startTime,
          delayMs: req.body.delayMs,
          hourlyLimit: req.body.hourlyLimit ?? undefined,
          idempotencyKey: req.body.idempotencyKey ?? undefined,
        }
      : req.body;

    const parsed = createBatchSchema.parse(input);
    const attachments: StoredAttachment[] = isMultipart
      ? multipartAttachments(req.files as Express.Multer.File[])
      : (parsed as { attachments?: StoredAttachment[] }).attachments ?? [];

    validateAttachments(attachments);

    const startTime = new Date(parsed.startTime);
    if (startTime.getTime() <= Date.now() - 30_000) {
      throw new ValidationError('startTime must not be in the past', [
        { field: 'startTime', issue: 'must not be in the past (30s clock-skew allowed)' },
      ]);
    }

    const result = await createBatch({
      userId: (req as AuthedRequest).user.id,
      subject: parsed.subject,
      body: parsed.body,
      recipients: parsed.recipients,
      startTime,
      delayMs: parsed.delayMs,
      hourlyLimit: parsed.hourlyLimit,
      senderId: parsed.senderId,
      fromEmail: (req as AuthedRequest).user.email,
      attachments,
      idempotencyKey: parsed.idempotencyKey,
    });

    res.status(result.idempotent ? 200 : 201).json({
      batchId: result.batch.id,
      status: result.status,
      totalRecipients: result.totalRecipients,
      validRecipients: result.validRecipients,
      invalidEmailsSkipped: result.invalidEmailsSkipped,
      duplicatesRemoved: result.duplicatesRemoved,
      firstScheduledAt: result.firstScheduledAt.toISOString(),
      lastScheduledAt: result.lastScheduledAt.toISOString(),
      idempotent: result.idempotent,
    });
  }),
);

// GET /api/config — scheduler constraints for the Compose form, sourced from
// backend configuration so the frontend never invents limits.
router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({
      scheduler: {
        minDelayMs: 1000,
        maxDelayMs: env.MAX_DELAY_MS_BETWEEN_EMAILS,
        defaultDelayMs: env.MIN_DELAY_MS_BETWEEN_EMAILS,
        maxRecipientsPerBatch: env.MAX_RECIPIENTS_PER_BATCH,
        maxEmailsPerHour: env.MAX_EMAILS_PER_HOUR,
        maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        subjectMaxLength: 200,
        bodyMaxLength: 50_000,
        attachments: {
          maxFiles: env.MAX_ATTACHMENTS_PER_EMAIL,
          maxFileSizeBytes: env.MAX_ATTACHMENT_SIZE_BYTES,
          maxTotalSizeBytes: env.MAX_TOTAL_ATTACHMENT_SIZE_BYTES,
          allowedTypes: env.ALLOWED_ATTACHMENT_TYPES,
        },
        stuckProcessingThresholdMs: env.STUCK_PROCESSING_THRESHOLD_MS,
        reconcileSweepIntervalMs: env.RECONCILE_SWEEP_INTERVAL_MS,
      },
    });
  }),
);

// GET /api/senders — historically populated the Compose sender dropdown. Kept
// for API completeness; the Compose form now always sends from the
// authenticated user's email.
router.get(
  '/senders',
  asyncHandler(async (_req, res) => {
    const senders = await listSenders();
    res.json({ senders });
  }),
);

// GET /api/emails/scheduled — pending/queued/processing jobs, soonest first.
router.get(
  '/emails/scheduled',
  asyncHandler(async (req, res) => {
    const query = listSchema.parse(req.query);
    const result = await listEmailJobs({
      userId: (req as AuthedRequest).user.id,
      tab: 'scheduled',
      status: query.status,
      page: query.page,
      limit: query.limit,
      batchId: query.batchId,
      senderId: query.senderId,
    });
    res.json(result);
  }),
);

// GET /api/emails/sent — sent/failed jobs, most recent first.
router.get(
  '/emails/sent',
  asyncHandler(async (req, res) => {
    const query = listSchema.parse(req.query);
    const result = await listEmailJobs({
      userId: (req as AuthedRequest).user.id,
      tab: 'sent',
      status: query.status,
      page: query.page,
      limit: query.limit,
      batchId: query.batchId,
      senderId: query.senderId,
    });
    res.json(result);
  }),
);

// GET /api/emails/:jobId — B4 verification endpoint: `bullmqJobId` non-null +
// `status: queued` confirms the enqueue step ran. 404 whether the job is
// missing or belongs to another user (no existence probing).
router.get(
  '/emails/:jobId',
  asyncHandler(async (req, res) => {
    const job = await getEmailJobById((req as AuthedRequest).user.id, req.params.jobId as string);
    if (!job) {
      throw new NotFoundError('Email job not found', 'JOB_NOT_FOUND');
    }
    res.json(job);
  }),
);

export default router;