'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth-context';

export default function HomePage() {
  const router = useRouter();
  const { user, initializing } = useAuth();

  useEffect(() => {
    if (initializing) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [initializing, user, router]);

  return (
    <div className="auth-shell">
      <div className="placeholder">Loading…</div>
    </div>
  );
}