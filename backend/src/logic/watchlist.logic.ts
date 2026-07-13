// The watchlist list view. Entries added in-app carry a snapshot (verdict/poster/director/releaseDate
// captured from /score at add-time), so the list renders with ZERO TMDB calls and is filterable by
// verdict server-side. Only legacy entries (added before snapshotting, i.e. seeded) fall back to a
// per-item TMDB lookup — and only for the page requested. Filtered by q + verdict, then paginated.
import type {
  ITmdbService,
  ILogic,
  MovieCredits,
  Verdict,
  WatchlistMovie,
  WatchlistScored,
} from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import { TtlCache } from '../lib/ttlCache.js';
import { verdictBand } from '../lib/affinity.js';
import type { MovieLookup } from './movieLookup.js';

export interface WatchlistInput {
  userKey: string;
  /** Title substring filter. */
  q?: string;
  /** Verdict filter (snapshot verdict; legacy entries without one are excluded when this is set). */
  verdict?: Verdict;
  page?: number;
  limit?: number;
}

export interface WatchlistPage {
  items: WatchlistScored[];
  hasMore: boolean;
  total: number;
}

const today = (): string => new Date().toISOString().slice(0, 10);
const hasSnapshot = (m: WatchlistMovie): boolean =>
  m.verdict != null || m.posterUrl != null || m.tmdbRating != null;

export class WatchlistLogic implements ILogic<WatchlistInput, WatchlistPage> {
  private readonly creditsCache = new TtlCache<MovieCredits>(6 * 60 * 60 * 1000);

  constructor(
    private readonly lookup: MovieLookup,
    private readonly tmdb: ITmdbService,
  ) {}

  async execute({ userKey, q, verdict, page = 0, limit = 20 }: WatchlistInput): Promise<WatchlistPage> {
    const all = await Profile.getWatchlist(userKey);
    const ql = q?.trim().toLowerCase();
    const filtered = all.filter(
      (m) =>
        (!ql || m.title.toLowerCase().includes(ql)) &&
        // Verdict filter matches the stored snapshot; legacy entries (no verdict) drop out.
        (!verdict || m.verdict === verdict),
    );
    const total = filtered.length;
    const slice = filtered.slice(page * limit, page * limit + limit);

    const scored = await Promise.all(slice.map((m) => this.toScored(m)));
    const items = scored.filter((s): s is WatchlistScored => s !== null);
    return { items, hasMore: (page + 1) * limit < total, total };
  }

  // Snapshot entries render straight from stored data (no TMDB). "Upcoming" is recomputed from the
  // stored releaseDate vs today, so it stays correct as time passes.
  private async toScored(m: WatchlistMovie): Promise<WatchlistScored | null> {
    if (hasSnapshot(m)) {
      const released = m.releaseDate ? m.releaseDate <= today() : true;
      return {
        title: m.title,
        year: m.year,
        type: m.type,
        verdict: released ? m.verdict ?? 'Skip' : 'Skip',
        tmdbRating: m.tmdbRating ?? 0,
        posterUrl: m.posterUrl,
        director: m.director,
        released,
      };
    }
    // Legacy entry (no snapshot) → enrich once via TMDB, same as before.
    const movie = await this.lookup.execute({ title: m.title, year: m.year });
    if (!movie) return null;
    const mediaType = movie.mediaType ?? 'movie';
    const credits = await this.creditsCache
      .remember(`${mediaType}:${movie.tmdbId}`, () => this.tmdb.credits(movie.tmdbId, mediaType))
      .catch((): MovieCredits => ({}));
    const released = movie.released !== false;
    return {
      title: m.title,
      year: m.year,
      type: m.type,
      verdict: released ? verdictBand(movie.rating) : 'Skip',
      tmdbRating: movie.rating,
      posterUrl: movie.posterUrl,
      director: credits.director,
      released,
    };
  }
}
