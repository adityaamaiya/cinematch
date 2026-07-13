import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ok } from '../lib/apiResponse.js';
import { watchlistAddBody, watchlistDeleteBody, watchlistQuery } from '../validators/schemas.js';
import { DEFAULT_PROFILE_KEY, Profile } from '../models/profile.model.js';
import type { WatchlistLogic } from '../logic/watchlist.logic.js';

// Personal watchlist on the single `default` profile (single-tenant deployment).
export class WatchlistController {
  constructor(private readonly watchlistLogic: WatchlistLogic) {}

  add: RequestHandler = asyncHandler(async (req, res) => {
    const { title, type, year, verdict, tmdbRating, posterUrl, director, leadActor, releaseDate } =
      watchlistAddBody.parse(req.body);
    // Store the /score snapshot so the list renders with no TMDB call + is verdict-filterable.
    await Profile.addToWatchlist(DEFAULT_PROFILE_KEY, {
      title,
      type,
      year,
      collectionId: 'manual',
      verdict,
      tmdbRating,
      posterUrl,
      director,
      leadActor,
      releaseDate,
    });
    res.json(ok({ added: true }));
  });

  list: RequestHandler = asyncHandler(async (req, res) => {
    const { q, verdict, page, limit } = watchlistQuery.parse(req.query);
    const result = await this.watchlistLogic.execute({
      userKey: DEFAULT_PROFILE_KEY,
      q,
      verdict,
      page,
      limit,
    });
    res.json(ok(result));
  });

  remove: RequestHandler = asyncHandler(async (req, res) => {
    const { title, year } = watchlistDeleteBody.parse(req.body);
    await Profile.removeFromWatchlist(DEFAULT_PROFILE_KEY, title, year);
    res.json(ok({ removed: true }));
  });
}
