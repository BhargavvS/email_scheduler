'use client';

import { useState } from 'react';

import DashboardLayout from '@/components/dashboard/DashboardLayout';
import EmailList from '@/components/dashboard/EmailList';
import MailboxToolbar from '@/components/dashboard/MailboxToolbar';
import { useMailbox } from '@/hooks/useMailbox';
import type { MailboxTab } from '@/types/email';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<MailboxTab>('scheduled');
  const { counts, rows, loading, error, refetch } = useMailbox(activeTab);

  const emptyLabel =
    activeTab === 'scheduled'
      ? 'No scheduled emails yet. Emails you schedule will appear here.'
      : 'No sent emails yet. Emails you send will appear here.';

  return (
    <DashboardLayout activeTab={activeTab} onTabChange={setActiveTab} counts={counts}>
      <MailboxToolbar onRefresh={refetch} />
      {loading ? (
        <div className="placeholder">Loading emails…</div>
      ) : error ? (
        <div className="mailbox-error">
          <p>{error}</p>
          <button type="button" className="schedule-retry" onClick={refetch}>
            Retry
          </button>
        </div>
      ) : (
        <EmailList rows={rows} emptyLabel={emptyLabel} />
      )}
    </DashboardLayout>
  );
}