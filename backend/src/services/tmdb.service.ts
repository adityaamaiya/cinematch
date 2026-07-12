// TMDB HTTP client. Owns the network call, auth, candidate selection (pickBest) and the memoized
// genre map; TmdbAdapter owns all response→domain shaping. Auth is the v4 read-access token, sent
// as a Bearer header on every call.
import type { ILogger, ITmdbService, MovieCredits, TmdbMovie, WatchInfo } from '../types/index.js';
import { AppError } from '../lib/errors.js';
import {
  TmdbAdapter,
  type TmdbCreditsRaw,
  type TmdbRegion,
  type TmdbSearchItem,
  type TmdbVideo,
} from '../adapters/tmdb.adapter.js';

export class TmdbService implements ITmdbService {
  private genreMap: Map<number, string> | null = null;
  private readonly adapter = new TmdbAdapter();

  constructor(
    private readonly baseUrl: string,
    private readonly readToken: string,
    private readonly logger: ILogger,
  ) {}

  async searchTitle(
    title: string,
    year?: number,
    preferredLanguages: string[] = [],
  ): Promise<TmdbMovie | null> {
    const data = await this.request<{ results: TmdbSearchItem[] }>('/search/multi', {
      query: title,
      include_adult: 'false',
    });
    const candidates = (data.results ?? []).filter(
      (r) => r.media_type === 'movie' || r.media_type === 'tv',
    );
    const best = this.pickBest(candidates, title, year, preferredLanguages);
    if (!best) return null;
    return this.adapter.adapt({ item: best, genres: await this.loadGenreMap() });
  }

  async discover(genreIds: number[], limit: number): Promise<TmdbMovie[]> {
    const data = await this.request<{ results: TmdbSearchItem[] }>('/discover/movie', {
      with_genres: genreIds.join(','),
      sort_by: 'vote_average.desc',
      'vote_count.gte': '300', // avoid obscure titles with a perfect score from 5 votes
      include_adult: 'false',
    });
    const genres = await this.loadGenreMap();
    return (data.results ?? [])
      .slice(0, limit)
      .map((item) => this.adapter.adapt({ item: { ...item, media_type: 'movie' }, genres }));
  }

  // JustWatch-via-TMDB availability for one country. Returns null when TMDB has no data.
  async watchProviders(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    country: string,
  ): Promise<WatchInfo | null> {
    const data = await this.request<{ results?: Record<string, TmdbRegion> }>(
      `/${mediaType}/${tmdbId}/watch/providers`,
      {},
    );
    return this.adapter.watch(data.results?.[country]);
  }

  // Best YouTube trailer URL, or undefined.
  async trailerUrl(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<string | undefined> {
    const data = await this.request<{ results?: TmdbVideo[] }>(`/${mediaType}/${tmdbId}/videos`, {});
    return this.adapter.trailer(data.results ?? []);
  }

  // Director + top-billed actor. Either may be missing (esp. for TV).
  async credits(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<MovieCredits> {
    const data = await this.request<TmdbCreditsRaw>(`/${mediaType}/${tmdbId}/credits`, {});
    return this.adapter.credits(data);
  }

  // Prefer an exact title match (then matching year, then preferred language, then popularity).
  // Language breaks ties among same-name candidates. Bonus 24→6 by rank: the min (+6) beats
  // popularity (≤5) so ANY preferred language outranks a non-preferred blockbuster, and the rank
  // gap (6) exceeds popularity too so rank-0 beats a more-popular rank-1. Max (+24) stays below a
  // year match (+30) — an on-page year always wins — and exact title (+100) is untouched.
  private pickBest(
    items: TmdbSearchItem[],
    title: string,
    year?: number,
    preferredLanguages: string[] = [],
  ): TmdbSearchItem | null {
    if (items.length === 0) return null;
    // Normalise punctuation before comparing: a URL slug ("avengers endgame") never carries the
    // colon/hyphen/apostrophe the real title has ("Avengers: Endgame"), which used to fail the gate
    // and return null even though TMDB found the film. Apostrophes vanish ("don't"→"dont"), every
    // other non-alphanumeric becomes a space ("spider-man"→"spider man", matching the slug's).
    const norm = (s: string) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const wanted = norm(title);
    const nameMatches = (name: string) =>
      name === wanted || name.includes(wanted) || wanted.includes(name);
    const scored = items
      .map((item) => {
        const name = norm(item.title ?? item.name ?? '');
        const itemYear = this.adapter.yearOf(item);
        let score = 0;
        if (name === wanted) score += 100;
        else if (nameMatches(name)) score += 40;
        if (year && itemYear === year) score += 30;
        const langRank = preferredLanguages.indexOf(item.original_language ?? '');
        if (langRank >= 0) score += Math.max(24 - langRank * 6, 6);
        score += Math.min(item.popularity ?? 0, 50) / 10;
        return { item, name, score };
      })
      .sort((a, b) => b.score - a.score);
    // Confidence gate: if even the best candidate's title doesn't match the query at all, this was
    // a non-title lookup (e.g. a random page's <h1>) — return null so the popup shows manual search
    // instead of a bogus verdict for whatever film TMDB guessed.
    const best = scored[0];
    return best.name && nameMatches(best.name) ? best.item : null;
  }

  // TMDB search returns genre ids only; fetch the id→name maps once (movie + tv) and memoize.
  private async loadGenreMap(): Promise<Map<number, string>> {
    if (this.genreMap) return this.genreMap;
    const map = new Map<number, string>();
    for (const kind of ['movie', 'tv'] as const) {
      const data = await this.request<{ genres: { id: number; name: string }[] }>(
        `/genre/${kind}/list`,
        {},
      );
      for (const g of data.genres ?? []) map.set(g.id, g.name);
    }
    this.genreMap = map;
    return map;
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.readToken}`, accept: 'application/json' },
    });
    if (!res.ok) {
      this.logger.warn(`TMDB ${path} failed`, res.status);
      throw AppError.upstream(`TMDB request failed (${res.status})`);
    }
    return (await res.json()) as T;
  }
}
