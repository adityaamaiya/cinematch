import { Router, type RequestHandler } from 'express';

export function watchlistRouter(handlers: {
  add: RequestHandler;
  list: RequestHandler;
  remove: RequestHandler;
}): Router {
  const router = Router();
  router.get('/watchlist', handlers.list);
  router.post('/watchlist', handlers.add);
  router.delete('/watchlist', handlers.remove);
  return router;
}
