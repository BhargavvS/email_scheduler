import type { MailboxViewRow } from '@/hooks/useMailbox';
import EmailRow from './EmailRow';

interface EmailListProps {
  rows: MailboxViewRow[];
  emptyLabel: string;
}

export default function EmailList({ rows, emptyLabel }: EmailListProps) {
  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }
  return (
    <div className="email-list">
      {rows.map((row) => (
        <EmailRow key={row.id} row={row} />
      ))}
    </div>
  );
}