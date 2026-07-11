import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ok } from '../lib/apiResponse.js';
import { syncProfileBody } from '../validators/schemas.js';
import { DEFAULT_PROFILE_KEY } from '../models/profile.model.js';
import type { SyncProfileLogic } from '../logic/syncProfile.logic.js';

export class ProfileController {
  constructor(private readonly syncProfileLogic: SyncProfileLogic) {}

  syncProfile: RequestHandler = asyncHandler(async (req, res) => {
    const { ratedMovies, watchlist } = syncProfileBody.parse(req.body);
    const result = await this.syncProfileLogic.execute({ ratedMovies, watchlist, userKey: DEFAULT_PROFILE_KEY });
    res.status(200).json(ok(result));
  });
}
