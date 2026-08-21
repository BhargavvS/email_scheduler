import crypto from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getGoogleAuthUrl } from '../config/oauth.js';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '../config/session.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthedRequest } from '../middleware/auth.js';
import {
  exchangeGoogleCode,
  getUserById,
  publicUser,
  registerWithEmail,
  upsertGoogleUser,
  verifyEmailPassword,
} from '../services/authService.js';

const router = Router();

const STATE_COOKIE = 'oauth_state';

const registerSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

// GET /auth/google — start the authorization-code flow.
router.get('/google', (_req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
  res.redirect(getGoogleAuthUrl(state));
});

// GET /auth/google/callback — exchange code, upsert user, set session, redirect home.
router.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    const expectedState = req.cookies?.[STATE_COOKIE];
    const fail = (err: string) => {
      res.clearCookie(STATE_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
      res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(err)}`);
    };

    if (typeof error === 'string') {
      logger.warn({ error }, 'Google OAuth returned error param');
      return fail('auth_cancelled');
    }
    if (typeof code !== 'string' || !code) {
      logger.warn({ hasCode: !!code, query: req.query }, 'Google callback missing code');
      return fail('auth_failed');
    }
    if (typeof state !== 'string' || !state || state !== expectedState) {
      logger.warn(
        { hasState: typeof state === 'string', hasExpectedState: !!expectedState, stateMatch: state === expectedState },
        'OAuth state mismatch — possible cookie not sent or expired',
      );
      return fail('auth_failed');
    }

    res.clearCookie(STATE_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
    try {
      const info = await exchangeGoogleCode(code);
      const user = await upsertGoogleUser(info);
      const token = signSession({ sub: user.id, email: user.email, provider: 'google' });
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions);
      // The frontend stores the token and authenticates every request with
      // `Authorization: Bearer <token>`, so the callback hands it over via a
      // query param (single-use redirect back into the app).
      res.redirect(`${env.FRONTEND_URL}/oauth/callback?token=${encodeURIComponent(token)}`);
    } catch (err) {
      logger.error({ err }, 'Google OAuth callback failed');
      fail('auth_failed');
    }
  }),
);

// POST /auth/register — email + password signup.
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const user = await registerWithEmail(body.email, body.password, body.name);
    const token = signSession({ sub: user.id, email: user.email, provider: 'password' });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions);
    res.status(201).json({ user: publicUser(user), token });
  }),
);

// POST /auth/login — email + password login.
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await verifyEmailPassword(body.email, body.password);
    const token = signSession({ sub: user.id, email: user.email, provider: 'password' });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions);
    res.json({ user: publicUser(user), token });
  }),
);

// POST /auth/logout — clear the session cookie.
router.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
  res.json({ ok: true });
});

// GET /auth/me — current session user.
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUserById((req as AuthedRequest).user.id);
    if (!user) {
      throw new HttpError(401, 'Session user no longer exists', 'AUTH_UNAUTHORIZED');
    }
    res.json({ user: publicUser(user) });
  }),
);

export default router;
