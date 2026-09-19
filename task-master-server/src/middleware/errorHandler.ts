import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/errors';

/**
 * Central error middleware. Serializes ApiError into the standard envelope and
 * returns a generic 500 for anything unexpected (never leaks internals).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An internal server error occurred' },
  });
}

/** 404 handler for unmatched routes. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
  });
}
