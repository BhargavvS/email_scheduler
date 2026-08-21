export const API_URL = process.env.NEXT_PUBLIC_API_URL;

import type {
  CreateBatchRequest,
  CreateBatchResponse,
  EmailJob,
  EmailJobsPage,
  SchedulerConfig,
  Sender,
} from '@/types/batch';

const TOKEN_KEY = 'reachinbox_token';
const USER_KEY = 'reachinbox_user';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function getStoredUser<T>(): T | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function storeUser<T>(user: T): void {
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredUser(): void {
  window.localStorage.removeItem(USER_KEY);
}

export interface ApiErrorDetail {
  field: string;
  issue: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    public readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  return fetch(url, { ...init, signal }).finally(() => clearTimeout(id));
}

/**
 * Authenticated fetch helper. Every request from the frontend carries the JWT
 * in the `Authorization: Bearer <token>` header (never cookies), matching the
 * backend's `requireAuth` which accepts either form.
 */
export async function api<T>(path: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  if (!API_URL) {
    throw new ApiError(500, 'CONFIG_ERROR', 'NEXT_PUBLIC_API_URL is not configured. Check frontend/.env.local and rebuild.');
  }
  const { timeoutMs, ...fetchOpts } = options as RequestInit & { timeoutMs?: number };
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOpts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // cache: 'no-store' — a cached /auth/me revalidated via If-None-Match comes
  // back as a bodiless 304, which is not res.ok and would look like an auth
  // failure. Authenticated API responses must always be fetched fresh.
  // credentials: 'include' — send the backend's httpOnly session cookie as a
  // fallback auth factor; the Bearer header above always takes precedence
  // server-side.
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_URL}${path}`,
      {
        ...fetchOpts,
        headers,
        credentials: 'include',
        cache: 'no-store',
      },
      timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(504, 'TIMEOUT', `Request timed out: ${path}`);
    }
    throw err;
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (!res.ok) {
    const errBody = body as {
      error?: { code?: string; message?: string; details?: ApiErrorDetail[] };
    } | null;
    const err = errBody?.error;
    throw new ApiError(
      res.status,
      err?.code,
      err?.message ?? `Request failed (${res.status})`,
      err?.details ?? [],
    );
  }

  return body as T;
}

export function getSenders(): Promise<{ senders: Sender[] }> {
  return api<{ senders: Sender[] }>('/api/senders');
}

export function getSchedulerConfig(): Promise<{ scheduler: SchedulerConfig }> {
  return api<{ scheduler: SchedulerConfig }>('/api/config', { timeoutMs: 8000 });
}

/**
 * Creates a batch. Sends multipart/form-data when the payload has attachments
 * (the backend accepts files directly), otherwise a JSON body.
 */
export function createBatch(payload: CreateBatchRequest): Promise<CreateBatchResponse> {
  const { attachments, ...rest } = payload;
  if (attachments && attachments.length > 0) {
    const form = new FormData();
    form.append('subject', rest.subject);
    form.append('body', rest.body);
    form.append('recipients', JSON.stringify(rest.recipients));
    form.append('startTime', rest.startTime);
    form.append('delayMs', String(rest.delayMs));
    if (rest.hourlyLimit !== undefined) form.append('hourlyLimit', String(rest.hourlyLimit));
    for (const attachment of attachments) {
      const bytes = Uint8Array.from(atob(attachment.dataBase64), (c) => c.charCodeAt(0));
      form.append(
        'attachments',
        new Blob([bytes], { type: attachment.contentType }),
        attachment.name,
      );
    }
    return rawFetch<CreateBatchResponse>('/api/batches', {
      method: 'POST',
      body: form,
    });
  }

  return api<CreateBatchResponse>('/api/batches', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getEmailJobs(
  tab: 'scheduled' | 'sent',
  opts: { page?: number; limit?: number; status?: string } = {},
): Promise<EmailJobsPage> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  return api<EmailJobsPage>(`/api/emails/${tab}${qs ? `?${qs}` : ''}`);
}

async function rawFetch<T>(path: string, options: RequestInit & { timeoutMs?: number }): Promise<T> {
  if (!API_URL) {
    throw new ApiError(500, 'CONFIG_ERROR', 'NEXT_PUBLIC_API_URL is not configured. Check frontend/.env.local and rebuild.');
  }
  const { timeoutMs, ...fetchOpts } = options as RequestInit & { timeoutMs?: number };
  const token = getToken();
  const headers: Record<string, string> = {
    ...(fetchOpts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_URL}${path}`,
      {
        ...fetchOpts,
        headers,
        credentials: 'include',
        cache: 'no-store',
      },
      timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(504, 'TIMEOUT', `Request timed out: ${path}`);
    }
    throw err;
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (!res.ok) {
    const errBody = body as {
      error?: { code?: string; message?: string; details?: ApiErrorDetail[] };
    } | null;
    const err = errBody?.error;
    throw new ApiError(
      res.status,
      err?.code,
      err?.message ?? `Request failed (${res.status})`,
      err?.details ?? [],
    );
  }

  return body as T;
}

export type { EmailJob };