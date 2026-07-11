import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ok } from '../lib/apiResponse.js';
import { watchlistAddBody, watchlistDeleteBody } from '../validators/schemas.js';
import { DEFAULT_PROFILE_KEY, Profile } from '../models/profile.model.js';
import type { WatchlistLogic } from '../logic/watchlist.logic.js';

// Personal watchlist on the single `default` profile (single-tenant deployment).
export class WatchlistController {
  constructor(private readonly watchlistLogic: WatchlistLogic) {}

  add: RequestHandler = asyncHandler(async (req, res) => {
    const { title, type, year } = watchlistAddBody.parse(req.body);
    await Profile.addToWatchlist(DEFAULT_PROFILE_KEY, { title, type, year, collectionId: 'manual' });
    res.json(ok({ added: true }));
  });

  list: RequestHandler = asyncHandler(async (_req, res) => {
    const items = await this.watchlistLogic.execute({ userKey: DEFAULT_PROFILE_KEY });
    res.json(ok(items));
  });

  remove: RequestHandler = asyncHandler(async (req, res) => {
    const { title, year } = watchlistDeleteBody.parse(req.body);
    await Profile.removeFromWatchlist(DEFAULT_PROFILE_KEY, title, year);
    res.json(ok({ removed: true }));
  });
}
