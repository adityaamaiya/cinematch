// TMDB HTTP client. Pure third-party adapter — no DB, no caching (that lives in the logic layer).
// Auth is the v4 read-access token, sent as a Bearer header on every call.
import type {
  ILogger,
  ITmdbService,
  MovieCredits,
  TmdbMovie,
  WatchInfo,
  WatchProvider,
} from '../types/index.js';
import { AppError } from '../lib/errors.js';

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const LOGO_BASE = 'https://image.tmdb.org/t/p/w92';

interface TmdbProvider {
  provider_name: string;
  logo_path?: string | null;
}

interface TmdbSearchItem {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string; // movie
  name?: string; // tv
  release_date?: string; // movie
  first_air_date?: string; // tv
  vote_average?: number;
  popularity?: number;
  genre_ids?: number[];
  poster_path?: string | null;
}

export class TmdbService implements ITmdbService {
  private genreMap: Map<number, string> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly readToken: string,
    private readonly logger: ILogger,
  ) {}

  async searchTitle(title: string, year?: number): Promise<TmdbMovie | null> {
    const data = await this.request<{ results: TmdbSearchItem[] }>('/search/multi', {
      query: title,
      include_adult: 'false',
    });
    const candidates = (data.results ?? []).filter(
      (r) => r.media_type === 'movie' || r.media_type === 'tv',
    );
    const best = this.pickBest(candidates, title, year);
    return best ? this.toMovie(best) : null;
  }

  async discover(genreIds: number[], limit: number): Promise<TmdbMovie[]> {
    const data = await this.request<{ results: TmdbSearchItem[] }>('/discover/movie', {
      with_genres: genreIds.join(','),
      sort_by: 'vote_average.desc',
      'vote_count.gte': '300', // avoid obscure titles with a perfect score from 5 votes
      include_adult: 'false',
    });
    const items = (data.results ?? []).slice(0, limit);
    return Promise.all(items.map((i) => this.toMovie({ ...i, media_type: 'movie' })));
  }

  // Prefer an exact title match (then matching year, then popularity).
  private pickBest(items: TmdbSearchItem[], title: string, year?: number): TmdbSearchItem | null {
    if (items.length === 0) return null;
    const wanted = title.trim().toLowerCase();
    const scored = items
      .map((item) => {
        const name = (item.title ?? item.name ?? '').toLowerCase();
        const itemYear = this.yearOf(item);
        let score = 0;
        if (name === wanted) score += 100;
        else if (name.includes(wanted) || wanted.includes(name)) score += 40;
        if (year && itemYear === year) score += 30;
        score += Math.min(item.popularity ?? 0, 50) / 10;
        return { item, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored[0].item;
  }

  // JustWatch-via-TMDB availability for one country. Returns null when TMDB has no data.
  async watchProviders(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    country: string,
  ): Promise<WatchInfo | null> {
    const data = await this.request<{
      results?: Record<
        string,
        { link?: string; flatrate?: TmdbProvider[]; rent?: TmdbProvider[]; buy?: TmdbProvider[] }
      >;
    }>(`/${mediaType}/${tmdbId}/watch/providers`, {});
    const region = data.results?.[country];
    if (!region) return null;
    const map = (list?: TmdbProvider[]): WatchProvider[] =>
      (list ?? []).map((p) => ({
        name: p.provider_name,
        logoUrl: p.logo_path ? `${LOGO_BASE}${p.logo_path}` : undefined,
      }));
    const info: WatchInfo = {
      link: region.link,
      flatrate: map(region.flatrate),
      rent: map(region.rent),
      buy: map(region.buy),
    };
    if (!info.flatrate.length && !info.rent.length && !info.buy.length) return null;
    return info;
  }

  // First YouTube trailer (falls back to a teaser) as a watch URL, or undefined.
  async trailerUrl(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<string | undefined> {
    const data = await this.request<{
      results?: { site?: string; type?: string; key?: string; official?: boolean }[];
    }>(`/${mediaType}/${tmdbId}/videos`, {});
    const yt = (data.results ?? []).filter((v) => v.site === 'YouTube' && v.key);
    const best =
      yt.find((v) => v.type === 'Trailer' && v.official) ??
      yt.find((v) => v.type === 'Trailer') ??
      yt.find((v) => v.type === 'Teaser') ??
      yt[0];
    return best?.key ? `https://www.youtube.com/watch?v=${best.key}` : undefined;
  }

  // Director (crew) + top-billed actor (cast order 0). Either may be missing (esp. for TV).
  async credits(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<MovieCredits> {
    const data = await this.request<{
      cast?: { name?: string; order?: number }[];
      crew?: { name?: string; job?: string }[];
    }>(`/${mediaType}/${tmdbId}/credits`, {});
    const director = (data.crew ?? []).find((c) => c.job === 'Director')?.name;
    const leadActor = [...(data.cast ?? [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))[0]?.name;
    return { director, leadActor };
  }

  private async toMovie(item: TmdbSearchItem): Promise<TmdbMovie> {
    const map = await this.loadGenreMap();
    const releaseDate = item.release_date ?? item.first_air_date ?? undefined;
    const today = new Date().toISOString().slice(0, 10);
    return {
      tmdbId: item.id,
      mediaType: item.media_type === 'tv' ? 'tv' : 'movie',
      title: item.title ?? item.name ?? 'Unknown',
      year: this.yearOf(item),
      rating: item.vote_average ?? 0,
      genres: (item.genre_ids ?? []).map((id) => map.get(id)).filter((g): g is string => !!g),
      posterUrl: item.poster_path ? `${IMAGE_BASE}${item.poster_path}` : undefined,
      releaseDate,
      released: !!releaseDate && releaseDate <= today,
    };
  }

  private yearOf(item: TmdbSearchItem): number | undefined {
    const date = item.release_date ?? item.first_air_date;
    const y = date ? Number(date.slice(0, 4)) : NaN;
    return Number.isFinite(y) ? y : undefined;
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
