import { Router, type RequestHandler } from 'express';

export function recommendRouter(handler: RequestHandler): Router {
  const router = Router();
  router.get('/recommend', handler);
  return router;
}
