// Composition root: build deps, wire logic → controllers → routers, mount middleware. Separate
// from index.ts so tests inject a mock TMDB client and skip the DB connection + bound port.
import express, { type Express } from 'express';
import type { IGeminiService, ILogger, IOmdbService, ITmdbService } from './types/index.js';
import { Logger } from './lib/logger.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { rateLimit } from './middleware/rateLimit.middleware.js';
import { healthRouter } from './routes/health.router.js';
import { scoreRouter } from './routes/score.router.js';
import { recommendRouter } from './routes/recommend.router.js';
import { profileRouter } from './routes/profile.router.js';
import { watchlistRouter } from './routes/watchlist.router.js';
import { ScoreController } from './controllers/score.controller.js';
import { RecommendController } from './controllers/recommend.controller.js';
import { ProfileController } from './controllers/profile.controller.js';
import { WatchlistController } from './controllers/watchlist.controller.js';
import { Scorer } from './logic/scorer.logic.js';
import { MovieLookup } from './logic/movieLookup.js';
import { ScoreLogic } from './logic/score.logic.js';
import { LlmTaste } from './logic/tasteLlm.logic.js';
import { RecommendLogic } from './logic/recommend.logic.js';
import { SyncProfileLogic } from './logic/syncProfile.logic.js';
import { WatchlistLogic } from './logic/watchlist.logic.js';

export interface AppDeps {
  tmdb: ITmdbService;
  omdb: IOmdbService;
  syncToken: string;
  /** Optional — enables the LLM taste mode. Absent → statistical Scorer only. */
  gemini?: IGeminiService;
  /** Precomputed taste-profile prose (taste-profile.md). LLM taste needs both this and gemini. */
  tasteProfile?: string;
  logger?: ILogger;
}

export function createApp(deps: AppDeps): Express {
  const logger = deps.logger ?? new Logger('http');
  const app = express();
  app.set('trust proxy', 1); // nginx is one hop in front — use X-Forwarded-For for req.ip
  app.use(express.json({ limit: '2mb' })); // profile syncs can be largish

  // Throttle the public TMDB-backed endpoints per IP (protects the shared TMDB quota).
  const publicLimiter = rateLimit({ windowMs: 60_000, max: 60 });

  // --- wire dependencies (interface → concrete, one place) ---
  const scorer = new Scorer();
  const lookup = new MovieLookup(deps.tmdb, logger);
  const llmTaste =
    deps.gemini && deps.tasteProfile?.trim()
      ? new LlmTaste(deps.gemini, deps.tasteProfile)
      : undefined;
  const scoreController = new ScoreController(
    new ScoreLogic(lookup, scorer, deps.tmdb, deps.omdb, llmTaste),
  );
  const recommendController = new RecommendController(new RecommendLogic(deps.tmdb, scorer));
  const profileController = new ProfileController(new SyncProfileLogic(lookup, deps.tmdb));
  const watchlistController = new WatchlistController(new WatchlistLogic(lookup, scorer, deps.tmdb));

  // --- routes ---
  app.use(healthRouter());
  app.use(publicLimiter, scoreRouter(scoreController.score));
  app.use(publicLimiter, recommendRouter(recommendController.recommend));
  app.use(profileRouter(profileController.syncProfile, deps.syncToken));
  app.use(
    publicLimiter,
    watchlistRouter({
      add: watchlistController.add,
      list: watchlistController.list,
      remove: watchlistController.remove,
    }),
  );

  // --- fallthrough ---
  app.use(notFoundMiddleware);
  app.use(errorMiddleware(logger));

  return app;
}
