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
  return (
    <div className="dashboard">
      <Sidebar activeTab={activeTab} onTabChange={onTabChange} counts={counts} />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <h1>Homepage</h1>
        </header>
        {children}
      </main>
    </div>
  );
}