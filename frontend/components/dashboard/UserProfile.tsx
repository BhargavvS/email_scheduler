'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import Avatar from '@/components/ui/Avatar';
import { ChevronDownIcon, LogOutIcon } from '@/components/ui/Icons';

export default function UserProfile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (!user) return null;

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  return (
    <div className="user-profile" ref={rootRef}>
      <button
        type="button"
        className="user-profile-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={user.name} email={user.email} avatarUrl={user.avatarUrl} size={36} />
        <span className="user-profile-info">
          <span className="user-profile-name">{user.name || user.email.split('@')[0]}</span>
          <span className="user-profile-email">{user.email}</span>
        </span>
        <ChevronDownIcon className="user-profile-chevron" />
      </button>

      {open ? (
        <div className="user-menu" role="menu">
          <div className="user-menu-header">
            <div className="user-menu-name">{user.name || user.email}</div>
            <div className="user-menu-email">{user.email}</div>
          </div>
          <button type="button" className="user-menu-item" role="menuitem">
            Account
          </button>
          <button type="button" className="user-menu-item" role="menuitem" onClick={handleLogout}>
            <LogOutIcon size={16} />
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}