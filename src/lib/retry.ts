import { logger } from '../config/logger.js';

export interface RetryOptions {
  label: string;
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Runs `fn` with exponential backoff. Throws the last error after `attempts`
 * are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { label, attempts = 5, baseDelayMs = 1000, maxDelayMs = 10000 }: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      logger.warn(
        { label, attempt, attempts, delayMs, error: (err as Error).message },
        `${label} not reachable — retry ${attempt}/${attempts} in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`${label} unreachable after ${attempts} attempts: ${(lastError as Error)?.message}`);
}