import { Pool } from 'pg';

/**
 * Opens a short-lived pool, runs SELECT 1, then closes. Throws if Postgres is
 * unreachable. Used for boot checks and /health probes so a down database
 * never hangs the process.
 */
export async function pingPostgres(databaseUrl: string): Promise<void> {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2000,
    max: 1,
  });
  try {
    await pool.query('SELECT 1');
  } finally {
    await pool.end();
  }
}

export async function checkPostgres(databaseUrl: string): Promise<boolean> {
  try {
    await pingPostgres(databaseUrl);
    return true;
  } catch {
    return false;
  }
}