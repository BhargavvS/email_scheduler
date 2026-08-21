import type { NextFunction, Request, Response } from 'express';

import { SESSION_COOKIE, verifySession } from '../config/session.js';
import { HttpError } from './error.js';

export interface AuthedUser {
  id: string;
  email: string;
}

export interface AuthedRequest extends Request {
  user: AuthedUser;
}

function extractToken(req: Request): string | undefined {
  // The Authorization header wins over the session cookie: the SPA always
  // sends the freshest token via Bearer, while a long-lived cookie may hold a
  // stale token from a previous session (e.g. signed before a secret or DB
  // reset). Verifying the cookie first would then reject an otherwise valid
  // request with 401.
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();

  const cookie = (req as AuthedRequest).cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;

  return undefined;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    next(new HttpError(401, 'Authentication required', 'AUTH_REQUIRED'));
    return;
  }
  try {
    const payload = verifySession(token);
    const authed = req as AuthedRequest;
    authed.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    next(new HttpError(401, 'Session expired or invalid', 'AUTH_EXPIRED'));
  }
}
