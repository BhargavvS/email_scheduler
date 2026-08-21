import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';

import { logger } from '../config/logger.js';

export interface ErrorDetail {
  field: string;
  issue: string;
}

/**
 * Base class for all application errors. `code` is a stable, machine-readable
 * string the frontend can switch on; `details` carries field-level issues used
 * to highlight specific form inputs.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class ValidationError extends HttpError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(400, message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string, code = 'NOT_FOUND') {
    super(404, message, code);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, code = 'CONFLICT') {
    super(409, message, code);
    this.name = 'ConflictError';
  }
}

function zodDetails(err: ZodError): ErrorDetail[] {
  const flat = err.flatten().fieldErrors;
  return Object.entries(flat).map(([field, issues]) => ({
    field,
    issue: issues?.join('; ') ?? 'invalid',
  }));
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Not found' },
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: zodDetails(err),
      },
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Attachment exceeds the per-file size limit'
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'Too many attachments'
          : `Upload failed: ${err.message}`;
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message,
        details: [{ field: 'attachments', issue: message }],
      },
    });
    return;
  }

  const isHttp = err instanceof HttpError;
  const status = isHttp ? err.status : 500;
  const code = isHttp ? err.code : 'INTERNAL_ERROR';
  const message = isHttp ? err.message : 'Internal server error';
  const details = isHttp ? err.details : undefined;

  if (status >= 500) {
    logger.error({ err, code }, 'Unhandled error');
  } else if (isHttp) {
    logger.warn({ err, code, status }, 'Request failed');
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(details && details.length > 0 ? { details } : {}),
    },
  });
}
