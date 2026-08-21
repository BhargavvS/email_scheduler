import type { User } from '@prisma/client';

import { googleOAuthClient } from '../config/oauth.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { HttpError } from '../middleware/error.js';

export interface GoogleUserInfo {
  googleId: string;
  email: string;
  name: string;
  picture?: string | null;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    provider: user.googleId ? 'google' : 'password',
  };
}

export async function exchangeGoogleCode(code: string): Promise<GoogleUserInfo> {
  let tokens;
  try {
    ({ tokens } = await googleOAuthClient.getToken(code));
  } catch {
    throw new HttpError(502, 'Failed to exchange code with Google', 'AUTH_GOOGLE_EXCHANGE_FAILED');
  }
  if (!tokens.id_token) {
    throw new HttpError(502, 'Google did not return an id_token', 'AUTH_GOOGLE_EXCHANGE_FAILED');
  }
  const ticket = await googleOAuthClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new HttpError(502, 'Google profile missing required fields', 'AUTH_GOOGLE_EXCHANGE_FAILED');
  }
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
    picture: payload.picture ?? null,
  };
}

export async function upsertGoogleUser(info: GoogleUserInfo): Promise<User> {
  return prisma.user.upsert({
    where: { googleId: info.googleId },
    update: {
      email: info.email,
      name: info.name,
      avatarUrl: info.picture ?? null,
    },
    create: {
      googleId: info.googleId,
      email: info.email,
      name: info.name,
      avatarUrl: info.picture ?? null,
    },
  });
}

export async function registerWithEmail(
  email: string,
  password: string,
  name?: string,
): Promise<User> {
  const normalizedEmail = email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new HttpError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
  }
  const passwordHash = await hashPassword(password);
  return prisma.user.create({
    data: {
      email: normalizedEmail,
      name: name?.trim() || normalizedEmail.split('@')[0] || 'User',
      passwordHash,
    },
  });
}

export async function verifyEmailPassword(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.passwordHash) {
    throw new HttpError(401, 'Invalid email or password', 'AUTH_INVALID_CREDENTIALS');
  }
  const matches = await verifyPassword(password, user.passwordHash);
  if (!matches) {
    throw new HttpError(401, 'Invalid email or password', 'AUTH_INVALID_CREDENTIALS');
  }
  return user;
}

export async function getUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}