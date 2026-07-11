// Cache-through TMDB lookup, shared by ScoreLogic + SyncProfileLogic (DRY). Checks ScoreCache
// first, falls back to TMDB, then writes back (caching misses too).
import type { ILogic, ILogger, ITmdbService, TmdbMovie } from '../types/index.js';
import { ScoreCache } from '../models/scoreCache.model.js';

export interface MovieLookupInput {
  title: string;
  year?: number;
}

export class MovieLookup implements ILogic<MovieLookupInput, TmdbMovie | null> {
  constructor(
    private readonly tmdb: ITmdbService,
    private readonly logger: ILogger,
  ) {}

  async execute({ title, year }: MovieLookupInput): Promise<TmdbMovie | null> {
    const key = `${title.trim().toLowerCase()}|${year ?? ''}`;
    const cached = await ScoreCache.get(key);
    if (cached !== undefined) return cached;

    const movie = await this.tmdb.searchTitle(title, year);
    await ScoreCache.put(key, movie);
    return movie;
  }
}
