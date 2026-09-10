import type { ReactNode } from 'react';

import type { MailboxCounts } from '@/hooks/useMailbox';
import type { MailboxTab } from '@/types/email';
import Sidebar from './Sidebar';

interface DashboardLayoutProps {
  activeTab: MailboxTab;
  onTabChange: (tab: MailboxTab) => void;
  counts: MailboxCounts | null;
  children: ReactNode;
}

export default function DashboardLayout({
  activeTab,
  onTabChange,
  counts,
  children,
}: DashboardLayoutProps) {
  const title = activeTab === 'scheduled' ? 'Scheduled' : 'Sent';
  const subtitle =
    activeTab === 'scheduled'
      ? 'Emails queued to send'
      : 'Emails already delivered';

  return (
    <div className="dashboard">
      <Sidebar activeTab={activeTab} onTabChange={onTabChange} counts={counts} />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </header>
        {children}
      </main>
    </div>
  );
}