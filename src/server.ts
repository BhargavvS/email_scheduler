import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { pingRedis } from './config/redis.js';
import { pingPostgres } from './db/pool.js';
import { withRetry } from './lib/retry.js';

async function bootstrap(): Promise<void> {
  logger.info('Checking PostgreSQL connectivity…');
  await withRetry(() => pingPostgres(env.DATABASE_URL), { label: 'PostgreSQL' });
  logger.info('PostgreSQL is reachable');

  logger.info('Checking Redis connectivity…');
  await withRetry(() => pingRedis(env.REDIS_URL), { label: 'Redis' });
  logger.info('Redis is reachable');

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, `API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});