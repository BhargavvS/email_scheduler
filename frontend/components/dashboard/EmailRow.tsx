import type { MailboxViewRow } from '@/hooks/useMailbox';
import { ClockIcon, SendIcon, StarIcon } from '@/components/ui/Icons';

export default function EmailRow({ row }: { row: MailboxViewRow }) {
  const StatusIcon = row.status === 'scheduled' ? ClockIcon : SendIcon;
  const isFailed = row.rawStatus === 'failed';

  return (
    <div className={`email-row ${isFailed ? 'is-failed' : ''}`}>
      <div className="email-row-main">
        <div className="email-row-top">
          <span className="email-recipient">To: {row.recipient}</span>
          <span className="email-row-meta">
            <StatusIcon size={14} />
            {row.timestamp}
            {isFailed ? <span className="email-badge-failed">failed</span> : null}
          </span>
        </div>
        <div className="email-subject">{row.subject}</div>
        <div className="email-preview">{row.preview}</div>
        {row.status === 'sent' && row.previewUrl ? (
          <a href={row.previewUrl} target="_blank" rel="noreferrer" className="email-preview-link">
            ↗ View in Ethereal
          </a>
        ) : row.status === 'sent' && !row.previewUrl ? (
          <span className="email-preview-hint">Sent (no Ethereal preview — using mock transport)</span>
        ) : null}
        {isFailed && row.error ? <div className="email-error-text">{row.error}</div> : null}
      </div>
      <button type="button" className="email-star" aria-label="Star email" title="Star">
        <StarIcon size={18} />
      </button>
    </div>
  );
}