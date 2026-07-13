// Composition root: build deps, wire logic → controllers → routers, mount middleware. Separate
// from index.ts so tests inject a mock TMDB client and skip the DB connection + bound port.
import express, { type Express } from 'express';
import type { ILlm, ILogger, IOmdbService, ITmdbService, TasteProfileRef } from './types/index.js';
import { Logger } from './lib/logger.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { rateLimit } from './middleware/rateLimit.middleware.js';
import { healthRouter } from './routes/health.router.js';
import { scoreRouter } from './routes/score.router.js';
import { recommendRouter } from './routes/recommend.router.js';
import { profileRouter } from './routes/profile.router.js';
import { watchlistRouter } from './routes/watchlist.router.js';
import { rateRouter } from './routes/rate.router.js';
import { tasteRouter } from './routes/taste.router.js';
import { ScoreController } from './controllers/score.controller.js';
import { RecommendController } from './controllers/recommend.controller.js';
import { ProfileController } from './controllers/profile.controller.js';
import { WatchlistController } from './controllers/watchlist.controller.js';
import { RateController } from './controllers/rate.controller.js';
import { TasteController } from './controllers/taste.controller.js';
import { MovieLookup } from './logic/movieLookup.js';
import { ScoreLogic } from './logic/score.logic.js';
import { LlmTaste } from './logic/tasteLlm.logic.js';
import { LlmRecommend } from './logic/llmRecommend.logic.js';
import { RecommendLogic } from './logic/recommend.logic.js';
import { SyncProfileLogic } from './logic/syncProfile.logic.js';
import { WatchlistLogic } from './logic/watchlist.logic.js';
import { RateLogic } from './logic/rate.logic.js';
import { GenerateTasteLogic } from './logic/generateTaste.logic.js';

export interface AppDeps {
  tmdb: ITmdbService;
  omdb: IOmdbService;
  syncToken: string;
  /** Optional — enables the LLM taste line + LLM recommendations. Absent → no taste line, discover-based /recommend. */
  llm?: ILlm;
  /** Mutable taste-profile prose + version (taste-profile.md, seeded at boot). LLM taste needs this + llm. */
  tasteRef?: TasteProfileRef;
  /** Absolute path the regen writes taste-profile.md to. Needed to enable regeneration. */
  tasteProfilePath?: string;
  /** New ratings that trigger an auto-regen (env TASTE_REGEN_EVERY). Default 10. */
  regenEvery?: number;
  logger?: ILogger;
}

export function createApp(deps: AppDeps): Express {
  const logger = deps.logger ?? new Logger('http');
  const app = express();
  app.set('trust proxy', 1); // nginx is one hop in front — use X-Forwarded-For for req.ip
  app.use(express.json({ limit: '2mb' })); // profile syncs can be largish

  // Tight limit on the TMDB-backed endpoints (/score, /recommend) — protects the shared TMDB quota.
  const publicLimiter = rateLimit({ windowMs: 60_000, max: 60 });
  // The watchlist/ratings lists are pure Mongo reads (snapshot data, no TMDB) and infinite-scroll a
  // page per scroll, so they get a much higher cap — the TMDB-protection limit doesn't apply to them.
  const listLimiter = rateLimit({ windowMs: 60_000, max: 300 });

  // --- wire dependencies (interface → concrete, one place) ---
  const lookup = new MovieLookup(deps.tmdb, logger);
  // Taste mode needs a provider + a shared prose ref. LlmTaste self-guards on an empty ref (a fresh
  // deployment with no profile yet), and the LLM recommend still uses the current prose text.
  const hasLlm = deps.llm && deps.tasteRef;
  const llmTaste = hasLlm ? new LlmTaste(deps.llm!, deps.tasteRef!) : undefined;
  const llmRecommend = hasLlm ? new LlmRecommend(deps.llm!, deps.tasteRef!.text) : undefined;
  // Regen also needs somewhere to persist the prose; without a path we can read but not rebuild it.
  const generateTaste =
    hasLlm && deps.tasteProfilePath
      ? new GenerateTasteLogic(deps.llm!, deps.tasteRef!, deps.tasteProfilePath, new Logger('taste-gen'))
      : undefined;

  const scoreController = new ScoreController(
    new ScoreLogic(lookup, deps.tmdb, deps.omdb, llmTaste, deps.tasteRef),
  );
  const recommendController = new RecommendController(
    new RecommendLogic(deps.tmdb, lookup, llmRecommend),
  );
  const profileController = new ProfileController(new SyncProfileLogic(lookup));
  const watchlistController = new WatchlistController(new WatchlistLogic(lookup, deps.tmdb));
  const rateController = new RateController(
    new RateLogic(deps.regenEvery ?? 10, new Logger('rate'), generateTaste),
  );
  const tasteController = generateTaste ? new TasteController(generateTaste) : undefined;

  // --- routes ---
  app.use(healthRouter());
  app.use(publicLimiter, scoreRouter(scoreController.score));
  app.use(publicLimiter, recommendRouter(recommendController.recommend));
  app.use(profileRouter(profileController.syncProfile, deps.syncToken));
  app.use(
    listLimiter,
    watchlistRouter({
      add: watchlistController.add,
      list: watchlistController.list,
      remove: watchlistController.remove,
    }),
  );
  app.use(listLimiter, rateRouter({ add: rateController.add, list: rateController.list }));
  // Manual regen is an LLM hit — throttle it harder than the general public limit.
  if (tasteController) {
    const regenLimiter = rateLimit({ windowMs: 60_000, max: 5 });
    app.use(regenLimiter, tasteRouter(tasteController.regenerate));
  }

  // --- fallthrough ---
  app.use(notFoundMiddleware);
  app.use(errorMiddleware(logger));

  return app;
}
