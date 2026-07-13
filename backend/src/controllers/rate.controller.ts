import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ok } from '../lib/apiResponse.js';
import { rateBody } from '../validators/schemas.js';
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

  // Raw ratings, newest first (addRating prepends). No TMDB enrichment — the row shows the user's
  // own verdict + the stored poster snapshot; clicking a row opens the enriched /score view.
  list: RequestHandler = asyncHandler(async (_req, res) => {
    const items = await Profile.getRatedMovies(DEFAULT_PROFILE_KEY);
    res.json(ok(items));
  });
}
