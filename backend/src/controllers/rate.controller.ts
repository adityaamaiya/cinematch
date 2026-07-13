import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ok } from '../lib/apiResponse.js';
import { rateBody, ratingsQuery } from '../validators/schemas.js';
import { DEFAULT_PROFILE_KEY, Profile } from '../models/profile.model.js';
import type { RateLogic } from '../logic/rate.logic.js';

// /rate (add a rating) + /ratings (list them). Single `default` profile (single-tenant deployment).
export class RateController {
  constructor(private readonly rateLogic: RateLogic) {}

  add: RequestHandler = asyncHandler(async (req, res) => {
    const { title, type, year, verdict, posterUrl } = rateBody.parse(req.body);
    await this.rateLogic.execute({ userKey: DEFAULT_PROFILE_KEY, title, type, year, verdict, posterUrl });
    res.json(ok({ rated: true }));
  });

  // Ratings are stored raw (title/verdict/poster snapshot), so listing filters + paginates in memory
  // — no TMDB. Newest first (addRating prepends). Clicking a row opens the enriched /score view.
  list: RequestHandler = asyncHandler(async (req, res) => {
    const { q, verdict, page, limit } = ratingsQuery.parse(req.query);
    const all = await Profile.getRatedMovies(DEFAULT_PROFILE_KEY);
    const ql = q?.trim().toLowerCase();
    const filtered = all.filter(
      (m) => (!ql || m.title.toLowerCase().includes(ql)) && (!verdict || m.verdict === verdict),
    );
    const items = filtered.slice(page * limit, page * limit + limit);
    res.json(ok({ items, hasMore: (page + 1) * limit < filtered.length, total: filtered.length }));
  });
}
