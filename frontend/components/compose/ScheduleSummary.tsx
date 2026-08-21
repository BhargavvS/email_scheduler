'use client';

import type { RecipientStats } from '@/hooks/useComposeEmail';

interface ScheduleSummaryProps {
  recipientCount: number;
  stats: RecipientStats;
  submitError: string | null;
  isSuccess: boolean;
  success: { batchId: string; validRecipients: number } | null;
  onRetry: () => void;
}

export default function ScheduleSummary({
  recipientCount,
  stats,
  submitError,
  isSuccess,
  success,
  onRetry,
}: ScheduleSummaryProps) {
  if (isSuccess && success) {
    return (
      <div className="schedule-summary schedule-success">
        <div className="schedule-success-title">✓ Batch scheduled successfully</div>
        <div className="schedule-success-detail">
          {success.validRecipients} recipients scheduled.
        </div>
      </div>
    );
  }

  if (submitError) {
    return (
      <div className="schedule-summary schedule-error">
        <div className="schedule-error-message">{submitError}</div>
        <button type="button" className="schedule-retry" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  const parts: string[] = [`${recipientCount} recipient${recipientCount === 1 ? '' : 's'}`];
  if (stats.invalid > 0) parts.push(`${stats.invalid} invalid`);
  if (stats.duplicatesRemoved > 0) parts.push(`${stats.duplicatesRemoved} dupes removed`);

  return (
    <div className="schedule-summary-new">
      <div className="summary-row">
        <span className="summary-dot" />
        <span className="summary-text">{parts.join(' · ')}</span>
        {stats.lastFileName ? <span className="summary-file">· {stats.lastFileName}</span> : null}
      </div>
      {recipientCount === 0 ? <div className="summary-hint">Add recipients to enable scheduling.</div> : null}
    </div>
  );
}