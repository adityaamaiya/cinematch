import type { GenreAffinity, ILogic, RatedMovie, Verdict, WatchlistMovie } from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import { mean, round2 } from '../lib/utils.js';
import type { MovieLookup } from './movieLookup.js';

const VERDICT_WEIGHT: Record<Verdict, number> = {
  Skip: 1,
  Timepass: 2,
  'Go For It': 3,
  Perfection: 4,
};

// Ignore genres with too few samples — one 5-star noir shouldn't make "Crime" a top genre.
const MIN_SAMPLES = 3;

export interface SyncProfileInput {
  userKey: string;
  ratedMovies: RatedMovie[];
  watchlist: WatchlistMovie[];
}

export interface SyncProfileResult {
  ratedCount: number;
  watchlistCount: number;
  genreCount: number;
}

export class SyncProfileLogic implements ILogic<SyncProfileInput, SyncProfileResult> {
  constructor(private readonly lookup: MovieLookup) {}

  async execute(input: SyncProfileInput): Promise<SyncProfileResult> {
    const genreAffinity = await this.computeAffinity(input.ratedMovies);
    await Profile.upsertProfile(input.userKey, {
      ratedMovies: input.ratedMovies,
      watchlist: input.watchlist,
      genreAffinity,
    });
    return {
      ratedCount: input.ratedMovies.length,
      watchlistCount: input.watchlist.length,
      genreCount: Object.keys(genreAffinity).length,
    };
  }

  // Affinity = per-genre mean verdict-weight minus the user's overall mean (relative preference,
  // to cancel the cinephile bias of rating almost everything highly).
  // ponytail: sequential TMDB lookups (cached) — fine one-off; parallelise if 500+ syncs get slow.
  private async computeAffinity(rated: RatedMovie[]): Promise<GenreAffinity> {
    const weightsByGenre: Record<string, number[]> = {};
    const allWeights: number[] = [];

    for (const m of rated) {
      const weight = VERDICT_WEIGHT[m.verdict];
      const movie = await this.lookup.execute({ title: m.title, year: m.year });
      if (!movie) continue;
      allWeights.push(weight);
      for (const genre of movie.genres) (weightsByGenre[genre] ??= []).push(weight);
    }

    if (allWeights.length === 0) return {};
    const overallMean = mean(allWeights);

    const affinity: GenreAffinity = {};
    for (const [genre, weights] of Object.entries(weightsByGenre)) {
      if (weights.length < MIN_SAMPLES) continue;
      affinity[genre] = round2(mean(weights) - overallMean);
    }
    return affinity;
  }
}
