// OMDb (omdbapi.com) client — the one source we use for awards + IMDb/critic ratings (TMDB has
// neither). Thin HTTP client: fetch + auth only; OmdbAdapter shapes the response. A no-op when
// OMDB_API_KEY is unset, so the feature degrades gracefully (data just omitted).
import type { ILogger, IOmdbService, OmdbInfo } from '../types/index.js';
import { OmdbAdapter, type OmdbResponse } from '../adapters/omdb.adapter.js';

export class OmdbService implements IOmdbService {
  private readonly adapter = new OmdbAdapter();

  constructor(
    private readonly apiKey: string, // '' → disabled
    private readonly logger: ILogger,
  ) {}

  async lookup(title: string, year?: number): Promise<OmdbInfo | null> {
    if (!this.apiKey) return null;
    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set('t', title);
    if (year) url.searchParams.set('y', String(year));

    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return this.adapter.adapt((await res.json()) as OmdbResponse);
    } catch (err) {
      this.logger.warn('OMDb lookup failed', err);
      return null;
    }
  }
}
