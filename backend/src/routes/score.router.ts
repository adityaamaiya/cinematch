import { Router, type RequestHandler } from 'express';

export function scoreRouter(handler: RequestHandler): Router {
  const router = Router();
  router.get('/score', handler);
  return router;
}
