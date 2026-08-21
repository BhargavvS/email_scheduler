import type { MailboxViewRow } from '@/hooks/useMailbox';
import { ClockIcon, SendIcon, StarIcon } from '@/components/ui/Icons';

export default function EmailRow({ row }: { row: MailboxViewRow }) {
  const StatusIcon = row.status === 'scheduled' ? ClockIcon : SendIcon;

  return (
    <div className="email-row">
      <div className="email-row-main">
        <div className="email-row-top">
          <span className="email-recipient">To: {row.recipient}</span>
          <span className="email-row-meta">
            <StatusIcon size={14} />
            {row.timestamp}
          </span>
        </div>
        <div className="email-subject">{row.subject}</div>
        <div className="email-preview">{row.preview}</div>
      </div>
      <button type="button" className="email-star" aria-label="Star email" title="Star">
        <StarIcon size={18} />
      </button>
    </div>
  );
}