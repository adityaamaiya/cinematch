import type { GenreAffinity, ILogic, ITmdbService, Mood, Recommendation } from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import { DEFAULT_GENRE_IDS, GENRE_NAME_TO_ID, MOOD_GENRES } from '../constants/moods.js';
import type { Scorer } from './scorer.logic.js';

export interface RecommendInput {
  mood?: Mood;
  genre?: string;
  limit: number;
  userKey: string;
}

export class RecommendLogic implements ILogic<RecommendInput, Recommendation[]> {
  constructor(
    private readonly tmdb: ITmdbService,
    private readonly scorer: Scorer,
  ) {}

  async execute(input: RecommendInput): Promise<Recommendation[]> {
    const affinity = await Profile.findAffinity(input.userKey);
    const genreIds = this.resolveGenreIds(input, affinity);

    const movies = await this.tmdb.discover(genreIds, input.limit);
    return Promise.all(
      movies.map(async (movie) => {
        const { verdict } = await this.scorer.execute({ movie, affinity });
        return {
          title: movie.title,
          year: movie.year,
          verdict,
          tmdbRating: movie.rating,
          posterUrl: movie.posterUrl,
        };
      }),
    );
  }

  // Priority: explicit genre → mood preset → top liked genres from the profile → Drama fallback.
  private resolveGenreIds(input: RecommendInput, affinity: GenreAffinity): number[] {
    if (input.genre) {
      const id = GENRE_NAME_TO_ID[input.genre.trim().toLowerCase()];
      if (id) return [id];
    }
    if (input.mood) return MOOD_GENRES[input.mood];

    const liked = Object.entries(affinity)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => GENRE_NAME_TO_ID[name.toLowerCase()])
      .filter((id): id is number => typeof id === 'number')
      .slice(0, 2);

    return liked.length > 0 ? liked : DEFAULT_GENRE_IDS;
  }
}
