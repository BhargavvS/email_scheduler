/**
 * Races a promise against a wall-clock timeout so an operation that would
 * block indefinitely (e.g. an ioredis command on a retrying connection when
 * Redis is down) fails fast instead of hanging the caller.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
