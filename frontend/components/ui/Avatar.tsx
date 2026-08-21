'use client';

import { useState } from 'react';

interface AvatarProps {
  name: string;
  email: string;
  avatarUrl?: string | null;
  size?: number;
  loading?: boolean;
}

function initials(name: string, email: string): string {
  const source = name.trim() || email.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function Avatar({ name, email, avatarUrl, size = 36, loading }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = avatarUrl && !failed;

  if (loading) {
    return (
      <span className="avatar avatar-skeleton" style={{ width: size, height: size }} aria-hidden />
    );
  }

  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl!} alt={name || email} onError={() => setFailed(true)} />
      ) : (
        <span>{initials(name, email)}</span>
      )}
    </span>
  );
}