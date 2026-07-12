// Maps a raw OMDb (omdbapi.com) response → our OmdbInfo. The service does the HTTP call; this
// class owns the response shaping (pick fields, drop "N/A", extract Rotten Tomatoes from Ratings).
import type { IAdapter, OmdbInfo } from '../types/index.js';

export interface OmdbResponse {
  Response?: string;
  Awards?: string;
  imdbRating?: string;
  imdbVotes?: string;
  Metascore?: string;
  Ratings?: { Source?: string; Value?: string }[];
}

export class OmdbAdapter implements IAdapter<OmdbResponse, OmdbInfo | null> {
  adapt(raw: OmdbResponse): OmdbInfo | null {
    if (!raw || raw.Response === 'False') return null;

    const clean = (v?: string) => (v && v !== 'N/A' ? v : undefined);
    const awards = clean(raw.Awards);
    const imdbRating = clean(raw.imdbRating);
    const imdbVotes = clean(raw.imdbVotes);
    const rottenTomatoes = clean(
      (raw.Ratings ?? []).find((r) => r.Source === 'Rotten Tomatoes')?.Value,
    );
    const metascore = clean(raw.Metascore);

    return awards || imdbRating || rottenTomatoes || metascore
      ? { awards, imdbRating, imdbVotes, rottenTomatoes, metascore }
      : null;
  }
}
