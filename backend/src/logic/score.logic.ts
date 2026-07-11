import type { ILogic, ITmdbService, ScoreResult, WatchInfo } from '../types/index.js';
import { AppError } from '../lib/errors.js';
import { Profile } from '../models/profile.model.js';
import type { MovieLookup } from './movieLookup.js';
import type { Scorer } from './scorer.logic.js';

export interface ScoreInput {
  title: string;
  year?: number;
  userKey: string;
}

// ponytail: single country for now (user is in India); make it a request/env param if needed.
const WATCH_COUNTRY = 'IN';

export class ScoreLogic implements ILogic<ScoreInput, ScoreResult> {
  constructor(
    private readonly lookup: MovieLookup,
    private readonly scorer: Scorer,
    private readonly tmdb: ITmdbService,
  ) {}

  async execute(input: ScoreInput): Promise<ScoreResult> {
    const movie = await this.lookup.execute({ title: input.title, year: input.year });
    if (!movie) throw AppError.notFound(`No TMDB match for "${input.title}"`, 'MOVIE_NOT_FOUND');

    // Verdict/taste are core; where-to-watch + trailer are extras that must never break a score.
    const [affinity, watch, trailerUrl] = await Promise.all([
      Profile.findAffinity(input.userKey),
      this.tmdb.watchProviders(movie.tmdbId, movie.mediaType, WATCH_COUNTRY).catch(() => null),
      this.tmdb.trailerUrl(movie.tmdbId, movie.mediaType).catch(() => undefined),
    ]);
    const scored = await this.scorer.execute({ movie, affinity });

    return {
      title: movie.title,
      year: movie.year,
      verdict: scored.verdict,
      tmdbRating: movie.rating,
      tasteMatch: scored.tasteMatch,
      posterUrl: movie.posterUrl,
      trailerUrl,
      watch: watch as WatchInfo | null,
    };
  }
}
