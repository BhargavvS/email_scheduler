'use client';

import type { MailboxCounts } from '@/hooks/useMailbox';
import type { MailboxTab } from '@/types/email';
import { ClockIcon, SendIcon } from '@/components/ui/Icons';

interface MailboxNavigationProps {
  activeTab: MailboxTab;
  onTabChange: (tab: MailboxTab) => void;
  counts: MailboxCounts | null;
}

const TABS: { key: MailboxTab; label: string; Icon: typeof ClockIcon }[] = [
  { key: 'scheduled', label: 'Scheduled', Icon: ClockIcon },
  { key: 'sent', label: 'Sent', Icon: SendIcon },
];

export default function MailboxNavigation({
  activeTab,
  onTabChange,
  counts,
}: MailboxNavigationProps) {
  return (
    <nav className="nav-group" aria-label="Mailbox">
      <div className="nav-label">Mailbox</div>
      {TABS.map(({ key, label, Icon }) => {
        const count = counts ? (key === 'scheduled' ? counts.scheduled : counts.sent) : null;
        return (
          <button
            key={key}
            type="button"
            className={`nav-item ${activeTab === key ? 'active' : ''}`}
            aria-current={activeTab === key ? 'page' : undefined}
            onClick={() => onTabChange(key)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {count !== null ? <span className="nav-count">{count}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}