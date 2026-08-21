'use client';

import { useState } from 'react';

import ComposePage from '@/components/compose/ComposePage';
import DashboardLayout from '@/components/dashboard/DashboardLayout';
import type { MailboxTab } from '@/types/email';

export default function ComposeRoute() {
  const [activeTab, setActiveTab] = useState<MailboxTab>('scheduled');

  return (
    <DashboardLayout activeTab={activeTab} onTabChange={setActiveTab} counts={null}>
      <ComposePage />
    </DashboardLayout>
  );
}