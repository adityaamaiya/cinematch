// Tiny in-memory fixed-window rate limiter. Keeps the public TMDB-backed endpoints from being
// hammered (which would burn the shared TMDB quota). Single pm2 instance → in-memory is fine.
// ponytail: no dependency, no Redis; swap for express-rate-limit + a store only if we scale out.
import type { Request, Response, NextFunction } from 'express';
import { fail } from '../lib/apiResponse.js';

interface Entry {
  count: number;
  resetAt: number;
}

export function rateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, Entry>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    let entry = hits.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(ip, entry);
      // Opportunistic sweep so the map can't grow unbounded from one-off IPs.
      if (hits.size > 10_000) for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }

    entry.count++;
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json(fail('Too many requests, slow down.', 'RATE_LIMITED'));
      return;
    }
    next();
  };
}
