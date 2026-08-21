import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MIN_DELAY_MS_BETWEEN_EMAILS: z.coerce.number().int().positive().default(2000),
  MAX_DELAY_MS_BETWEEN_EMAILS: z.coerce.number().int().positive().default(3_600_000),
  MAX_EMAILS_PER_HOUR: z.coerce.number().int().positive().default(200),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().positive().default(50),
  MAX_RECIPIENTS_PER_BATCH: z.coerce.number().int().positive().default(5000),

  MAX_ATTACHMENTS_PER_EMAIL: z.coerce.number().int().positive().default(5),
  MAX_ATTACHMENT_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  MAX_TOTAL_ATTACHMENT_SIZE_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  ALLOWED_ATTACHMENT_TYPES: z
    .string()
    .default(
      'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg,image/gif,text/plain,text/csv,application/zip',
    )
    .transform((v) =>
      v
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),

  SEND_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  SEND_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
  RATE_LIMIT_REDIS_FAIL_MODE: z.enum(['closed']).default('closed'),

  // B6 restart-hardening thresholds (reconciliation sweep).
  STUCK_PROCESSING_THRESHOLD_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  RECONCILE_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 1000),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  JWT_SESSION_SECRET: z.string().min(16),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  API_ORIGIN: z.string().url().default('http://localhost:4000'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => {
      const name = issue.path.join('.') || '(root)';
      return `  - ${name}: ${issue.message}`;
    })
    .join('\n');
  console.error(`Environment validation failed. Missing or malformed variables:\n${details}`);
  process.exit(1);
}

export const env = parsed.data;
