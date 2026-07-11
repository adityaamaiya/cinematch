import type { ILogic, ScoreResult } from '../types/index.js';
import { AppError } from '../lib/errors.js';
import { Profile } from '../models/profile.model.js';
import type { MovieLookup } from './movieLookup.js';
import type { Scorer } from './scorer.logic.js';

export interface ScoreInput {
  title: string;
  year?: number;
  userKey: string;
}

export class ScoreLogic implements ILogic<ScoreInput, ScoreResult> {
  constructor(
    private readonly lookup: MovieLookup,
    private readonly scorer: Scorer,
  ) {}

  async execute(input: ScoreInput): Promise<ScoreResult> {
    const movie = await this.lookup.execute({ title: input.title, year: input.year });
    if (!movie) throw AppError.notFound(`No TMDB match for "${input.title}"`, 'MOVIE_NOT_FOUND');

    const affinity = await Profile.findAffinity(input.userKey);
    const scored = await this.scorer.execute({ movie, affinity });

    return {
      title: movie.title,
      year: movie.year,
      verdict: scored.verdict,
      tmdbRating: movie.rating,
      tasteMatch: scored.tasteMatch,
      posterUrl: movie.posterUrl,
    };
  }
}
