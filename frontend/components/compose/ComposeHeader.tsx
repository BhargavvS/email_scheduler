'use client';

import Link from 'next/link';

export default function ComposeHeader() {
  return (
    <div className="compose-header">
      <div className="compose-header-left">
        <Link href="/dashboard" className="compose-back" aria-label="Back to dashboard">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19L5 12L12 5" /></svg>
        </Link>
        <div>
          <h2>Compose</h2>
          <p>Create and schedule a new campaign</p>
        </div>
      </div>
      <div className="compose-header-badge">
        <span className="compose-header-dot" />
        Draft — not yet scheduled
      </div>
    </div>
  );
}