import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ok } from '../lib/apiResponse.js';
import { DEFAULT_PROFILE_KEY } from '../models/profile.model.js';
import type { GenerateTasteLogic } from '../logic/generateTaste.logic.js';

// Manual taste-profile regen (the popup's "Refresh taste" button). Synchronous here — the caller
// wants to know when the new profile is ready — but rate-limited hard at the router (it's an LLM hit).
export class TasteController {
  constructor(private readonly generateTaste: GenerateTasteLogic) {}

  regenerate: RequestHandler = asyncHandler(async (_req, res) => {
    const regenerated = await this.generateTaste.execute({ userKey: DEFAULT_PROFILE_KEY });
    res.json(ok({ regenerated }));
  });
}
