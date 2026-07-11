import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ok } from '../lib/apiResponse.js';
import { recommendQuery } from '../validators/schemas.js';
import { DEFAULT_PROFILE_KEY } from '../models/profile.model.js';
import type { RecommendLogic } from '../logic/recommend.logic.js';

export class RecommendController {
  constructor(private readonly recommendLogic: RecommendLogic) {}

  recommend: RequestHandler = asyncHandler(async (req, res) => {
    const { mood, genre, limit } = recommendQuery.parse(req.query);
    const result = await this.recommendLogic.execute({ mood, genre, limit, userKey: DEFAULT_PROFILE_KEY });
    res.json(ok(result));
  });
}
