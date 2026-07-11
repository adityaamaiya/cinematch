// Composition root: build deps, mount routes + middleware. Separate from index.ts so tests
// import the app without a DB connection or bound port. Services get instantiated here.
import express, { type Express } from 'express';
import { Logger } from './lib/logger.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { healthRouter } from './routes/health.router.js';

export function createApp(): Express {
  const app = express();
  const logger = new Logger('http');

  app.use(express.json({ limit: '2mb' })); // profile syncs can be largish

  // --- routes ---
  app.use(healthRouter());
  // Phase 3 mounts: scoreRouter, recommendRouter, profileRouter.

  // --- fallthrough ---
  app.use(notFoundMiddleware);
  app.use(errorMiddleware(logger));

  return app;
}
