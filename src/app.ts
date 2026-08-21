import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { pinoHttp } from 'pino-http';

import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRouter from './routes/auth.js';
import batchesRouter from './routes/batches.js';
import healthRouter from './routes/health.js';

export function createApp(): express.Express {
  const app = express();

  // Authenticated JSON endpoints must never be heuristically cached: a browser
  // that revalidates with If-None-Match gets a bodiless 304, which clients
  // correctly read as "no user data". No ETag + no-store keeps every response
  // a fresh 200 with a body.
  app.set('etag', false);
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/api', batchesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
