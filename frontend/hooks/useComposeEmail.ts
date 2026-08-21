'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  createBatch,
  getSchedulerConfig,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { User } from '@/lib/types';
import { parseLeadText, readLeadFile, type ParsedLeads } from '@/lib/recipientParser';
import type { AttachmentItem, SchedulerConfig } from '@/types/batch';

export interface ComposeFormState {
  recipients: string[];
  subject: string;
  body: string;
  startTime: string;
  delaySeconds: string;
  hourlyLimit: string;
  attachments: AttachmentItem[];
}

export interface RecipientStats {
  lastFileName: string | null;
  valid: number;
  invalid: number;
  duplicatesRemoved: number;
  missingEmailColumn: boolean;
}

export interface ComposeFieldErrors {
  recipients?: string;
  subject?: string;
  body?: string;
  startTime?: string;
  delaySeconds?: string;
  hourlyLimit?: string;
  attachments?: string;
}

export interface LoadState {
  loading: boolean;
  error: string | null;
}

export interface ComposeApi {
  user: User;
  state: ComposeFormState;
  config: SchedulerConfig | null;
  load: LoadState;
  recipientStats: RecipientStats;
  fieldErrors: ComposeFieldErrors;
  submitError: string | null;
  isParsing: boolean;
  isSubmitting: boolean;
  isSuccess: boolean;
  success: { batchId: string; validRecipients: number } | null;
  setField: <K extends keyof ComposeFormState>(key: K, value: ComposeFormState[K]) => void;
  addRecipient: (email: string) => boolean;
  removeRecipient: (email: string) => void;
  handleFile: (file: File) => Promise<void>;
  addAttachments: (files: FileList | File[]) => void;
  removeAttachment: (name: string) => void;
  validate: () => boolean;
  submit: () => Promise<void>;
  retryLoad: () => void;
  reset: () => void;
}

function hasMeaningfulBody(html: string): boolean {
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length > 0;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultStartTime(): string {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  return toLocalInputValue(next);
}

async function fileToAttachment(file: File): Promise<AttachmentItem> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    dataBase64: base64,
  };
}

const FALLBACK_CONFIG: SchedulerConfig = {
  minDelayMs: 1000,
  maxDelayMs: 3_600_000,
  defaultDelayMs: 2000,
  maxRecipientsPerBatch: 5000,
  maxEmailsPerHour: 200,
  maxEmailsPerHourPerSender: 50,
  subjectMaxLength: 200,
  bodyMaxLength: 50000,
  attachments: {
    maxFiles: 5,
    maxFileSizeBytes: 10 * 1024 * 1024,
    maxTotalSizeBytes: 25 * 1024 * 1024,
    allowedTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png',
      'image/jpeg',
      'image/gif',
      'text/plain',
      'text/csv',
      'application/zip',
    ],
  },
};

export function useComposeEmail(): ComposeApi {
  const { user } = useAuth();
  const [config, setConfig] = useState<SchedulerConfig | null>(FALLBACK_CONFIG);
  const [load, setLoad] = useState<LoadState>({ loading: false, error: null });
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [state, setState] = useState<ComposeFormState>({
    recipients: [],
    subject: '',
    body: '',
    startTime: defaultStartTime(),
    delaySeconds: String(Math.round(FALLBACK_CONFIG.defaultDelayMs / 1000)),
    hourlyLimit: String(FALLBACK_CONFIG.maxEmailsPerHourPerSender),
    attachments: [],
  });
  const [recipientStats, setRecipientStats] = useState<RecipientStats>({
    lastFileName: null,
    valid: 0,
    invalid: 0,
    duplicatesRemoved: 0,
    missingEmailColumn: false,
  });
  const [fieldErrors, setFieldErrors] = useState<ComposeFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<ComposeApi['success']>(null);

  const loadData = useCallback(async () => {
    // Non-blocking background refresh — UI is already usable with FALLBACK_CONFIG
    try {
      const configRes = await getSchedulerConfig();
      setConfig(configRes.scheduler);
      setState((prev) => ({
        ...prev,
        delaySeconds:
          prev.delaySeconds === String(Math.round(FALLBACK_CONFIG.defaultDelayMs / 1000))
            ? String(Math.round(configRes.scheduler.defaultDelayMs / 1000))
            : prev.delaySeconds,
        hourlyLimit:
          prev.hourlyLimit === String(FALLBACK_CONFIG.maxEmailsPerHourPerSender)
            ? String(configRes.scheduler.maxEmailsPerHourPerSender)
            : prev.hourlyLimit,
        startTime: prev.startTime || defaultStartTime(),
      }));
      setLoad({ loading: false, error: null });
    } catch (err) {
      // Keep fallback config usable; surface error as non-blocking banner
      // Only show error if we haven't successfully loaded real config yet
      setLoad({
        loading: false,
        error:
          err instanceof ApiError && err.code === 'TIMEOUT'
            ? 'Could not reach server quickly — using default limits. Check if backend is running on :4000.'
            : err instanceof ApiError
              ? err.message
              : 'Unable to load compose settings. Using defaults.',
      });
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadAttempt, loadData]);

  const setField = useCallback(
    <K extends keyof ComposeFormState>(key: K, value: ComposeFormState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
      setSubmitError(null);
      setSuccess(null);
    },
    [],
  );

  const addRecipient = useCallback(
    (email: string) => {
      const candidate = email.trim().toLowerCase();
      if (!candidate) return false;
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate);
      if (!emailOk) {
        setFieldErrors((prev) => ({
          ...prev,
          recipients: 'Invalid email address',
        }));
        return false;
      }
      setFieldErrors((prev) => ({ ...prev, recipients: undefined }));
      setState((prev) => {
        if (prev.recipients.includes(candidate)) return prev;
        return { ...prev, recipients: [...prev.recipients, candidate] };
      });
      setRecipientStats((prev) => ({ ...prev, valid: prev.valid + 1 }));
      return true;
    },
    [],
  );

  const removeRecipient = useCallback((email: string) => {
    setState((prev) => ({ ...prev, recipients: prev.recipients.filter((r) => r !== email) }));
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setIsParsing(true);
    setSubmitError(null);
    setSuccess(null);
    try {
      const read = await readLeadFile(file);
      if (read.error) {
        setRecipientStats({
          lastFileName: read.fileName,
          valid: 0,
          invalid: 0,
          duplicatesRemoved: 0,
          missingEmailColumn: false,
        });
        setFieldErrors((prev) => ({ ...prev, recipients: read.error! }));
        return;
      }
      const parsed = parseLeadText(read.text!, read.kind);
      if (parsed.missingEmailColumn) {
        setRecipientStats({
          lastFileName: read.fileName,
          valid: 0,
          invalid: 0,
          duplicatesRemoved: 0,
          missingEmailColumn: true,
        });
        setFieldErrors((prev) => ({
          ...prev,
          recipients: 'Could not find an email column in this file.',
        }));
        return;
      }
      setState((prev) => {
        const merged = Array.from(new Set([...prev.recipients, ...parsed.valid]));
        return { ...prev, recipients: merged };
      });
      setRecipientStats({
        lastFileName: read.fileName,
        valid: parsed.valid.length,
        invalid: parsed.invalid,
        duplicatesRemoved: parsed.duplicatesRemoved,
        missingEmailColumn: false,
      });
      setFieldErrors((prev) => ({ ...prev, recipients: undefined }));
    } catch {
      setRecipientStats({
        lastFileName: file.name,
        valid: 0,
        invalid: 0,
        duplicatesRemoved: 0,
        missingEmailColumn: false,
      });
      setFieldErrors((prev) => ({ ...prev, recipients: 'Could not parse file.' }));
    } finally {
      setIsParsing(false);
    }
  }, []);

  const addAttachments = useCallback(
    async (files: FileList | File[]) => {
      const cfg = config;
      if (!cfg) return;
      const incoming = Array.from(files);
      const errors: string[] = [];

      if (state.attachments.length + incoming.length > cfg.attachments.maxFiles) {
        errors.push(`You can attach up to ${cfg.attachments.maxFiles} files.`);
      }

      const allowed = new Set(cfg.attachments.allowedTypes.map((t) => t.toLowerCase()));
      const currentTotal = state.attachments.reduce((sum, a) => sum + a.size, 0);

      let added: AttachmentItem[] = [];
      for (const file of incoming) {
        const type = (file.type || 'application/octet-stream').toLowerCase();
        if (!allowed.has(type)) {
          errors.push(`"${file.name}" has an unsupported file type.`);
          continue;
        }
        if (file.size > cfg.attachments.maxFileSizeBytes) {
          errors.push(
            `"${file.name}" exceeds the ${Math.round(cfg.attachments.maxFileSizeBytes / 1024 / 1024)} MB per-file limit.`,
          );
          continue;
        }
        if (currentTotal + file.size > cfg.attachments.maxTotalSizeBytes) {
          errors.push('Attachments exceed the total size limit.');
          continue;
        }
        added.push(await fileToAttachment(file));
      }

      if (errors.length > 0) {
        setFieldErrors((prev) => ({ ...prev, attachments: errors.join(' ') }));
      } else {
        setFieldErrors((prev) => ({ ...prev, attachments: undefined }));
      }
      if (added.length > 0) {
        setState((prev) => ({ ...prev, attachments: [...prev.attachments, ...added] }));
      }
    },
    [config, state.attachments],
  );

  const removeAttachment = useCallback((name: string) => {
    setState((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((a) => a.name !== name),
    }));
    setFieldErrors((prev) => ({ ...prev, attachments: undefined }));
  }, []);

  const validate = useCallback((): boolean => {
    const errors: ComposeFieldErrors = {};
    const cfg = config!;

    if (state.recipients.length === 0) {
      errors.recipients = 'Add at least one valid recipient before scheduling.';
    } else if (state.recipients.length > cfg.maxRecipientsPerBatch) {
      errors.recipients = `Too many recipients. Maximum is ${cfg.maxRecipientsPerBatch}.`;
    }

    if (!state.subject.trim()) errors.subject = 'Subject is required.';
    else if (state.subject.trim().length > cfg.subjectMaxLength)
      errors.subject = `Subject must be at most ${cfg.subjectMaxLength} characters.`;

    if (!hasMeaningfulBody(state.body)) errors.body = 'Email body is required.';
    else if (state.body.length > cfg.bodyMaxLength)
      errors.body = `Email body is too long (max ${cfg.bodyMaxLength} characters).`;

    const delayNum = Number(state.delaySeconds);
    const delayMs = delayNum * 1000;
    if (!state.startTime) {
      errors.startTime = 'Start time is required.';
    } else {
      const start = new Date(state.startTime);
      if (Number.isNaN(start.getTime())) {
        errors.startTime = 'Start time is invalid.';
      } else if (start.getTime() <= Date.now() - 30_000) {
        errors.startTime = 'Start time must be in the future.';
      }
    }

    if (!Number.isFinite(delayNum) || delayNum < 1) {
      errors.delaySeconds = 'Delay must be a positive number.';
    } else if (!Number.isInteger(delayNum)) {
      errors.delaySeconds = 'Delay must be a whole number.';
    } else if (delayMs > cfg.maxDelayMs) {
      errors.delaySeconds = `Delay must be at most ${cfg.maxDelayMs / 1000} seconds.`;
    }

    if (state.hourlyLimit.trim() !== '') {
      const limit = Number(state.hourlyLimit);
      if (!Number.isInteger(limit) || limit < 1) {
        errors.hourlyLimit = 'Hourly limit must be a positive integer.';
      } else if (limit > cfg.maxEmailsPerHour) {
        errors.hourlyLimit = `Hourly limit must be at most ${cfg.maxEmailsPerHour}.`;
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [config, state]);

  const submit = useCallback(async () => {
    setSubmitError(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const delayMs = Math.round(Number(state.delaySeconds) * 1000);
      const result = await createBatch({
        recipients: state.recipients,
        subject: state.subject.trim(),
        body: state.body,
        startTime: new Date(state.startTime).toISOString(),
        delayMs,
        ...(state.hourlyLimit.trim() !== ''
          ? { hourlyLimit: Math.round(Number(state.hourlyLimit)) }
          : {}),
        ...(state.attachments.length > 0 ? { attachments: state.attachments } : {}),
      });
      setSuccess({ batchId: result.batchId, validRecipients: result.validRecipients });
    } catch (err) {
      if (err instanceof ApiError && err.details.length > 0) {
        const mapped: ComposeFieldErrors = {};
        for (const d of err.details) {
          if (d.field === 'delayMs') mapped.delaySeconds = d.issue;
          else if (d.field === 'recipients') mapped.recipients = d.issue;
          else if (d.field === 'attachments') mapped.attachments = d.issue;
          else if (d.field in mapped) mapped[d.field as keyof ComposeFieldErrors] = d.issue;
        }
        setFieldErrors(mapped);
      }
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : 'Unable to schedule the email. Please check your connection and try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [state, validate]);

  const retryLoad = useCallback(() => {
    setLoadAttempt((n) => n + 1);
  }, []);

  const reset = useCallback(() => {
    setState({
      recipients: [],
      subject: '',
      body: '',
      startTime: defaultStartTime(),
      delaySeconds: config ? String(Math.round(config.defaultDelayMs / 1000)) : '',
      hourlyLimit: config ? String(config.maxEmailsPerHourPerSender) : '',
      attachments: [],
    });
    setRecipientStats({ lastFileName: null, valid: 0, invalid: 0, duplicatesRemoved: 0, missingEmailColumn: false });
    setFieldErrors({});
    setSubmitError(null);
    setSuccess(null);
  }, [config]);

  const isSuccess = success !== null;

  return useMemo(
    () => ({
      user: user as User,
      state,
      config,
      load,
      recipientStats,
      fieldErrors,
      submitError,
      isParsing,
      isSubmitting,
      isSuccess,
      success,
      setField,
      addRecipient,
      removeRecipient,
      handleFile,
      addAttachments,
      removeAttachment,
      validate,
      submit,
      retryLoad,
      reset,
    }),
    [
      user,
      state,
      config,
      load,
      recipientStats,
      fieldErrors,
      submitError,
      isParsing,
      isSubmitting,
      isSuccess,
      success,
      setField,
      addRecipient,
      removeRecipient,
      handleFile,
      addAttachments,
      removeAttachment,
      validate,
      submit,
      retryLoad,
      reset,
    ],
  );
}

export type { ParsedLeads };