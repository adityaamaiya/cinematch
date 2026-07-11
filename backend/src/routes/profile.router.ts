import { Router, type RequestHandler } from 'express';
import { requireSyncToken } from '../middleware/auth.middleware.js';

// POST /sync-profile is token-guarded — it's the only write endpoint.
export function profileRouter(handler: RequestHandler, syncToken: string): Router {
  const router = Router();
  router.post('/sync-profile', requireSyncToken(syncToken), handler);
  return router;
}
