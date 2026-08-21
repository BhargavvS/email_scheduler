'use client';

import type { User } from '@/lib/types';
import { LockIcon } from '@/components/ui/Icons';

export default function FromField({ user }: { user: User }) {
  const initial = (user.name || user.email || 'U')[0]?.toUpperCase();
  return (
    <div className="compose-field">
      <label className="compose-label">From</label>
      <div className="from-field-new">
        <div className="from-avatar">{initial}</div>
        <div className="from-meta">
          <span className="from-name">{user.name || user.email.split('@')[0]}</span>
          <span className="from-email">{user.email}</span>
        </div>
        <span className="from-lock" title="Locked to your authenticated account">
          <LockIcon size={14} />
          <span>Verified sender</span>
        </span>
      </div>
    </div>
  );
}