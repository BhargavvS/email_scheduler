import nodemailer, { type SentMessageInfo, type Transporter } from 'nodemailer';

export interface MailerSenderConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export function isMailerSenderConfig(value: unknown): value is MailerSenderConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.host === 'string' &&
    typeof v.port === 'number' &&
    typeof v.secure === 'boolean' &&
    typeof v.user === 'string' &&
    typeof v.pass === 'string'
  );
}

const transporters = new Map<string, Transporter>();

const PLACEHOLDER_USERS = new Set(['ethereal.user', 'ethereal.pass', 'placeholder']);

function isPlaceholderConfig(c: MailerSenderConfig): boolean {
  return PLACEHOLDER_USERS.has(c.user) || PLACEHOLDER_USERS.has(c.pass) || c.user === 'ethereal.user';
}

/**
 * Builds a cached Nodemailer transport per sender once per process. Transports
 * are keyed by sender id, so the worker never reconstructs one per job.
 * In dev, placeholder Ethereal credentials (from `prisma/seed.ts`) fall back to
 * a JSON transport so jobs still mark as `sent` without needing `npm run ethereal:setup`.
 */
export function getTransporter(senderId: string, smtpConfig: unknown): Transporter {
  const cached = transporters.get(senderId);
  if (cached) return cached;

  if (!isMailerSenderConfig(smtpConfig)) {
    throw new Error(`sender ${senderId} has no valid smtp_config`);
  }

  // Fallback for seed placeholder — prevents "all emails stuck in queued" when
  // the dev never ran `npm run ethereal:setup` (which replaces placeholder with a real Ethereal account).
  if (isPlaceholderConfig(smtpConfig)) {
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    transporters.set(senderId, transporter);
    return transporter;
  }

  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: { user: smtpConfig.user, pass: smtpConfig.pass },
  });
  transporters.set(senderId, transporter);
  return transporter;
}

export function etherealPreviewUrl(info: SentMessageInfo): string | null {
  const url = nodemailer.getTestMessageUrl(info);
  return url === false ? null : url;
}
