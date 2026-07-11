// Bearer guard for /sync-profile — stops the public internet from poisoning the taste profile.
import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

export function requireSyncToken(expectedToken: string): RequestHandler {
  return (req, _res, next) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || token !== expectedToken) {
      throw AppError.unauthorized('Invalid or missing sync token');
    }
    next();
  };
}
