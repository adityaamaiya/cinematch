import { Router, type RequestHandler } from 'express';

export function rateRouter(handlers: { add: RequestHandler; list: RequestHandler }): Router {
  const router = Router();
  router.post('/rate', handlers.add);
  router.get('/ratings', handlers.list);
  return router;
}
