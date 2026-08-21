'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';

/**
 * Landing page for the Google OAuth round-trip. The backend's
 * /auth/google/callback redirects here as
 * `/oauth/callback?token=<jwt>`. We read the token, hand it to the auth
 * context (which stores it + validates via /auth/me), then replace the URL so
 * the token is not left in the address bar / history.
 */
export default function OAuthCallbackPage() {
  const { completeGoogleLogin } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const error = params.get('error');
    if (error) {
      setStatus('error');
      return;
    }
    if (!token) {
      setStatus('error');
      return;
    }

    completeGoogleLogin(token)
      .then(() => {
        setStatus('ok');
        // scrub token from URL without hard reload — then navigate via Next router
        window.history.replaceState({}, '', window.location.pathname);
        router.replace('/dashboard');
      })
      .catch(() => setStatus('error'));
  }, [completeGoogleLogin, router]);

  return (
    <div className="auth-shell">
      <div className="auth-card">
        {status === 'loading' ? (
          <>
            <h1 className="auth-title">Signing you in…</h1>
            <p className="auth-subtitle">Verifying your Google account.</p>
          </>
        ) : status === 'ok' ? (
          <>
            <h1 className="auth-title">Signed in</h1>
            <p className="auth-subtitle">Redirecting to your dashboard…</p>
          </>
        ) : (
          <>
            <h1 className="auth-title">Sign-in failed</h1>
            <p className="auth-subtitle">
              We couldn&apos;t complete the Google sign-in. <Link href="/login">Back to login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
