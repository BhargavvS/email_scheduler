import jwt from 'jsonwebtoken';

import { env } from './env.js';

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_MS = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  sub: string;
  email: string;
  provider: 'google' | 'password';
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SESSION_SECRET, { expiresIn: `${env.SESSION_TTL_DAYS}d` });
}

export function verifySession(token: string): SessionPayload {
  return jwt.verify(token, env.JWT_SESSION_SECRET) as SessionPayload;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_TTL_MS,
};