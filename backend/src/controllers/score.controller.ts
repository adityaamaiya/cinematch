import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ok } from '../lib/apiResponse.js';
import { scoreQuery } from '../validators/schemas.js';
import { DEFAULT_PROFILE_KEY } from '../models/profile.model.js';
import type { ScoreLogic } from '../logic/score.logic.js';

// Handlers for the /score resource. Arrow-fn properties keep `this` bound when passed to a router.
export class ScoreController {
  constructor(private readonly scoreLogic: ScoreLogic) {}

  score: RequestHandler = asyncHandler(async (req, res) => {
    const { title, year } = scoreQuery.parse(req.query);
    const result = await this.scoreLogic.execute({ title, year, userKey: DEFAULT_PROFILE_KEY });
    res.json(ok(result));
  });
}
