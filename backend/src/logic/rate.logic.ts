// Persist a rating, then trigger a taste-profile regen once enough new ratings have accrued. The
// regen is fire-and-forget: a rating must succeed even if the (LLM-backed) regen fails or is slow.
import type { ILogger, ILogic, RatedMovie } from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import type { GenerateTasteLogic } from './generateTaste.logic.js';

export interface RateInput extends RatedMovie {
  userKey: string;
}

export class RateLogic implements ILogic<RateInput, { rated: true }> {
  constructor(
    /** How many new ratings trigger an auto-regen. */
    private readonly regenEvery: number,
    private readonly logger: ILogger,
    /** Absent when no LLM is configured — then ratings just accumulate (no auto-regen). */
    private readonly generateTaste?: GenerateTasteLogic,
  ) {}

  async execute({ userKey, ...movie }: RateInput): Promise<{ rated: true }> {
    const sinceRegen = await Profile.addRating(userKey, movie);
    if (this.generateTaste && sinceRegen >= this.regenEvery) {
      // Background — don't make the user wait on Gemini, and never let a regen error fail the rating.
      void this.generateTaste
        .execute({ userKey })
        .catch((err) => this.logger.error('background taste regen threw', err));
    }
    return { rated: true };
  }
}
