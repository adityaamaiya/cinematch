// Cache-through TMDB lookup, shared by ScoreLogic + SyncProfileLogic (DRY). Checks ScoreCache
// first, falls back to TMDB, then writes back (caching misses too).
import type { ILogic, ILogger, ITmdbService, TmdbMovie } from '../types/index.js';
import { ScoreCache } from '../models/scoreCache.model.js';

export interface MovieLookupInput {
  title: string;
  year?: number;
  /** Language priority (ISO 639-1) to break same-name ties; part of the cache key. */
  preferredLanguages?: string[];
}

export class MovieLookup implements ILogic<MovieLookupInput, TmdbMovie | null> {
  constructor(
    private readonly tmdb: ITmdbService,
    private readonly logger: ILogger,
  ) {}

  async execute({ title, year, preferredLanguages = [] }: MovieLookupInput): Promise<TmdbMovie | null> {
    // Language pref changes which same-name title we pick, so it's part of the key — otherwise a
    // no-pref sync lookup and a preferred score lookup (or a re-synced, changed pref) would collide.
    const key = `${title.trim().toLowerCase()}|${year ?? ''}|${preferredLanguages.join(',')}`;
    const cached = await ScoreCache.get(key);
    if (cached !== undefined) return cached;

    const movie = await this.tmdb.searchTitle(title, year, preferredLanguages);
    await ScoreCache.put(key, movie);
    return movie;
  }
}
