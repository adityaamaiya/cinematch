// Score every title on the user's watchlist and rank it by taste match, so the top of the backlog
// is the stuff most their-taste. Reuses MovieLookup (cached TMDB) + Scorer, and adds the director.
import type {
  ILogic,
  ITmdbService,
  MovieCredits,
  TasteMatchLevel,
  WatchlistScored,
} from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import { TtlCache } from '../lib/ttlCache.js';
import type { MovieLookup } from './movieLookup.js';
import type { Scorer } from './scorer.logic.js';

export interface WatchlistInput {
  userKey: string;
}

// Sort key: strong > mild > (none) > mismatch, then higher TMDB rating.
const LEVEL_RANK: Record<TasteMatchLevel, number> = { strong: 3, mild: 2, mismatch: 0 };

export class WatchlistLogic implements ILogic<WatchlistInput, WatchlistScored[]> {
  private readonly creditsCache = new TtlCache<MovieCredits>(6 * 60 * 60 * 1000);

  constructor(
    private readonly lookup: MovieLookup,
    private readonly scorer: Scorer,
    private readonly tmdb: ITmdbService,
  ) {}

  async execute({ userKey }: WatchlistInput): Promise<WatchlistScored[]> {
    const [items, affinities] = await Promise.all([
      Profile.getWatchlist(userKey),
      Profile.findAffinities(userKey),
    ]);

    const scored = await Promise.all(
      items.map(async (item): Promise<WatchlistScored | null> => {
        const movie = await this.lookup.execute({ title: item.title, year: item.year });
        if (!movie) return null;
        const mediaType = movie.mediaType ?? 'movie';
        // Credits before scoring so the director/actor signals feed the taste blend (same as /score).
        const credits = await this.creditsCache
          .remember(`${mediaType}:${movie.tmdbId}`, () => this.tmdb.credits(movie.tmdbId, mediaType))
          .catch((): MovieCredits => ({}));
        // Unreleased titles have no real rating → no verdict (list shows "Upcoming").
        const released = movie.released !== false;
        const { verdict, tasteMatch } = released
          ? await this.scorer.execute({
              movie,
              affinity: affinities.genreAffinity,
              director: credits.director,
              leadActor: credits.leadActor,
              directorAffinity: affinities.directorAffinity,
              actorAffinity: affinities.actorAffinity,
            })
          : { verdict: 'Skip' as const, tasteMatch: null };
        return {
          title: item.title,
          year: item.year,
          type: item.type,
          verdict,
          tmdbRating: movie.rating,
          tasteMatch,
          posterUrl: movie.posterUrl,
          director: credits.director,
          released,
        };
      }),
    );

    return scored
      .filter((s): s is WatchlistScored => s !== null)
      .sort(
        (a, b) =>
          this.rankOf(b.tasteMatch?.level) - this.rankOf(a.tasteMatch?.level) ||
          b.tmdbRating - a.tmdbRating,
      );
  }

  private rankOf(level: TasteMatchLevel | undefined): number {
    return level ? LEVEL_RANK[level] : 1;
  }
}
