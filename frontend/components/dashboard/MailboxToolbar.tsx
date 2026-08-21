'use client';

import { FilterIcon, RefreshIcon, SearchIcon } from '@/components/ui/Icons';

interface MailboxToolbarProps {
  onRefresh: () => void;
}

export default function MailboxToolbar({ onRefresh }: MailboxToolbarProps) {
  return (
    <div className="mailbox-toolbar">
      <SearchBar />
      <button type="button" className="icon-btn" aria-label="Filter emails" title="Filter">
        <FilterIcon />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Refresh"
        title="Refresh"
        onClick={onRefresh}
      >
        <RefreshIcon />
      </button>
    </div>
  );
}

function SearchBar() {
  return (
    <div className="search-bar">
      <SearchIcon size={16} />
      <input type="text" placeholder="Search" aria-label="Search emails" />
    </div>
  );
}