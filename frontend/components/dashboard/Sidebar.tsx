import type { MailboxCounts } from '@/hooks/useMailbox';
import type { MailboxTab } from '@/types/email';
import ComposeButton from './ComposeButton';
import Logo from './Logo';
import MailboxNavigation from './MailboxNavigation';
import UserProfile from './UserProfile';

interface SidebarProps {
  activeTab: MailboxTab;
  onTabChange: (tab: MailboxTab) => void;
  counts: MailboxCounts | null;
}

export default function Sidebar({ activeTab, onTabChange, counts }: SidebarProps) {
  return (
    <aside className="sidebar">
      <Logo />
      <UserProfile />
      <ComposeButton />
      <MailboxNavigation activeTab={activeTab} onTabChange={onTabChange} counts={counts} />
    </aside>
  );
}