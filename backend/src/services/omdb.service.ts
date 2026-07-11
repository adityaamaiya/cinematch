// OMDb (omdbapi.com) client — the one source we use for awards + IMDb rating (TMDB has neither).
// A no-op when OMDB_API_KEY is unset, so the feature degrades gracefully (awards just omitted).
import type { ILogger, IOmdbService, OmdbInfo } from '../types/index.js';

interface OmdbResponse {
  Response?: string;
  Awards?: string;
  imdbRating?: string;
}

export class OmdbService implements IOmdbService {
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

    let data: OmdbResponse;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      data = (await res.json()) as OmdbResponse;
    } catch (err) {
      this.logger.warn('OMDb lookup failed', err);
      return null;
    }
    if (!data || data.Response === 'False') return null;

    const clean = (v?: string) => (v && v !== 'N/A' ? v : undefined);
    const awards = clean(data.Awards);
    const imdbRating = clean(data.imdbRating);
    return awards || imdbRating ? { awards, imdbRating } : null;
  }
}
