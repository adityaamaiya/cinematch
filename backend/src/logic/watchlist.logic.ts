// Score every title on the user's watchlist (objective verdict) and sort best-first. Taste is the
// LLM's job on /score; the list stays a fast overview and does NOT fire a Gemini call per item
// (opening a long list would otherwise blow the rate limit). Reuses MovieLookup + shows the director.
import type { ILogic, ITmdbService, MovieCredits, WatchlistScored } from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import { TtlCache } from '../lib/ttlCache.js';
import { verdictBand } from '../lib/affinity.js';
import type { MovieLookup } from './movieLookup.js';

export interface WatchlistInput {
  userKey: string;
}

export class WatchlistLogic implements ILogic<WatchlistInput, WatchlistScored[]> {
  private readonly creditsCache = new TtlCache<MovieCredits>(6 * 60 * 60 * 1000);

  constructor(
    private readonly lookup: MovieLookup,
    private readonly tmdb: ITmdbService,
  ) {}

  async execute({ userKey }: WatchlistInput): Promise<WatchlistScored[]> {
    const items = await Profile.getWatchlist(userKey);
    const scored = await Promise.all(
      items.map(async (item): Promise<WatchlistScored | null> => {
        const movie = await this.lookup.execute({ title: item.title, year: item.year });
        if (!movie) return null;
        const mediaType = movie.mediaType ?? 'movie';
        const credits = await this.creditsCache
          .remember(`${mediaType}:${movie.tmdbId}`, () => this.tmdb.credits(movie.tmdbId, mediaType))
          .catch((): MovieCredits => ({}));
        // Unreleased titles have no real rating → no verdict (list shows "Upcoming").
        const released = movie.released !== false;
        return {
          title: item.title,
          year: item.year,
          type: item.type,
          verdict: released ? verdictBand(movie.rating) : 'Skip',
          tmdbRating: movie.rating,
          posterUrl: movie.posterUrl,
          director: credits.director,
          released,
        };
      }),
    );

    // Released first, then by TMDB rating (best-of-the-backlog on top).
    return scored
      .filter((s): s is WatchlistScored => s !== null)
      .sort((a, b) => Number(b.released) - Number(a.released) || b.tmdbRating - a.tmdbRating);
  }
}
