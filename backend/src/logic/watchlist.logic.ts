// Score every title on the user's watchlist and rank it by taste match, so the top of the backlog
// is the stuff most their-taste. Reuses MovieLookup (cached TMDB) + Scorer.
import type { ILogic, TasteMatchLevel, WatchlistScored } from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import type { MovieLookup } from './movieLookup.js';
import type { Scorer } from './scorer.logic.js';

export interface WatchlistInput {
  userKey: string;
}

// Sort key: strong > mild > (none) > mismatch, then higher TMDB rating.
const LEVEL_RANK: Record<TasteMatchLevel, number> = { strong: 3, mild: 2, mismatch: 0 };
const rankOf = (level: TasteMatchLevel | undefined) => (level ? LEVEL_RANK[level] : 1);

export class WatchlistLogic implements ILogic<WatchlistInput, WatchlistScored[]> {
  constructor(
    private readonly lookup: MovieLookup,
    private readonly scorer: Scorer,
  ) {}

  async execute({ userKey }: WatchlistInput): Promise<WatchlistScored[]> {
    const [items, affinity] = await Promise.all([
      Profile.getWatchlist(userKey),
      Profile.findAffinity(userKey),
    ]);

    const scored = await Promise.all(
      items.map(async (item): Promise<WatchlistScored | null> => {
        const movie = await this.lookup.execute({ title: item.title, year: item.year });
        if (!movie) return null;
        const { verdict, tasteMatch } = await this.scorer.execute({ movie, affinity });
        return {
          title: item.title,
          year: item.year,
          type: item.type,
          verdict,
          tmdbRating: movie.rating,
          tasteMatch,
          posterUrl: movie.posterUrl,
        };
      }),
    );

    return scored
      .filter((s): s is WatchlistScored => s !== null)
      .sort(
        (a, b) =>
          rankOf(b.tasteMatch?.level) - rankOf(a.tasteMatch?.level) || b.tmdbRating - a.tmdbRating,
      );
  }
}
