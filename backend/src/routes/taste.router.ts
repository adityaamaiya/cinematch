import { Router, type RequestHandler } from 'express';

export function tasteRouter(regenerate: RequestHandler): Router {
  const router = Router();
  router.post('/regenerate-taste', regenerate);
  return router;
}
