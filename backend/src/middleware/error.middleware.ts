// Central error handler → always an ApiResponse. AppError keeps its status/code, ZodError → 400,
// anything else → logged 500.
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { fail } from '../lib/apiResponse.js';
import type { ILogger } from '../types/index.js';

export function errorMiddleware(logger: ILogger): ErrorRequestHandler {
  // 4-arg signature is what marks this as Express error middleware.
  return (err, _req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(fail(err.message, err.code));
      return;
    }

    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      res.status(400).json(fail(message, 'VALIDATION_ERROR'));
      return;
    }

    logger.error('Unhandled error', err);
    res.status(500).json(fail('Internal server error', 'INTERNAL_ERROR'));
  };
}

/** 404 fallback for unmatched routes. */
export const notFoundMiddleware: import('express').RequestHandler = (_req, res) => {
  res.status(404).json(fail('Route not found', 'NOT_FOUND'));
};
