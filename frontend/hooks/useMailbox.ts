'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError, getEmailJobs } from '@/lib/api';
import type { EmailJob, EmailJobStatus, EmailJobsPage } from '@/types/batch';
import type { MailboxTab } from '@/types/email';

export interface MailboxViewRow {
  id: string;
  recipient: string;
  subject: string;
  preview: string;
  status: 'scheduled' | 'sent';
  timestamp: string;
}

export interface MailboxCounts {
  scheduled: number;
  sent: number;
}

interface UseMailboxResult {
  counts: MailboxCounts | null;
  rows: MailboxViewRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatTimestamp(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const SCHEDULED_STATUSES: EmailJobStatus[] = ['pending', 'queued', 'processing'];

function jobToRow(job: EmailJob, tab: MailboxTab): MailboxViewRow {
  const scheduled = new Date(job.scheduledAt);
  const sent = job.sentAt ? new Date(job.sentAt) : null;
  const isScheduled = tab === 'scheduled' && SCHEDULED_STATUSES.includes(job.status);
  return {
    id: job.id,
    recipient: job.recipient,
    subject: job.subject,
    preview: stripHtml(job.body).slice(0, 200),
    status: isScheduled ? 'scheduled' : 'sent',
    timestamp: isScheduled ? formatTimestamp(scheduled) : formatTimestamp(sent ?? scheduled),
  };
}

export function useMailbox(tab: MailboxTab): UseMailboxResult {
  const [counts, setCounts] = useState<MailboxCounts | null>(null);
  const [rows, setRows] = useState<MailboxViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const refetch = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [list, scheduled, sent] = await Promise.all([
          getEmailJobs(tab, { limit: 50 }),
          getEmailJobs('scheduled', { limit: 1 }),
          getEmailJobs('sent', { limit: 1 }),
        ]);
        if (!active) return;
        setRows(list.data.map((job) => jobToRow(job, tab)));
        setCounts({ scheduled: scheduled.pagination.total, sent: sent.pagination.total });
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Unable to load emails. Please check your connection.',
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tab, attempt]);

  return { counts, rows, loading, error, refetch };
}