// GET /health — liveness check, no DB dependency.
import { Router } from 'express';
import { ok } from '../lib/apiResponse.js';

export function healthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json(ok({ status: 'ok', uptime: process.uptime() }));
  });
  return router;
}
