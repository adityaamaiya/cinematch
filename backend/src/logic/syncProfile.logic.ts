import type { ILogic, RatedMovie, WatchlistMovie } from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import { rankLanguages } from '../lib/affinity.js';
import type { MovieLookup } from './movieLookup.js';

export interface SyncProfileInput {
  userKey: string;
  ratedMovies: RatedMovie[];
  watchlist: WatchlistMovie[];
}

export interface SyncProfileResult {
  ratedCount: number;
  watchlistCount: number;
  languageCount: number;
}

// Persists the profile + derives the language priority (for same-name disambiguation). Taste is the
// LLM's job now, so sync no longer fetches per-film credits or builds affinity maps — it just needs
// each rated film's language, which comes free with the cached TMDB lookup (much faster seeding).
export class SyncProfileLogic implements ILogic<SyncProfileInput, SyncProfileResult> {
  constructor(private readonly lookup: MovieLookup) {}

  async execute(input: SyncProfileInput): Promise<SyncProfileResult> {
    const languages = await this.resolveLanguages(input.ratedMovies);
    const languagePriority = rankLanguages(languages);
    await Profile.upsertProfile(input.userKey, {
      ratedMovies: input.ratedMovies,
      watchlist: input.watchlist,
      languagePriority,
    });
    return {
      ratedCount: input.ratedMovies.length,
      watchlistCount: input.watchlist.length,
      languageCount: languagePriority.length,
    };
  }

  // Resolve each rated film to its TMDB language (cached lookups; no credits call).
  // No preferredLanguages passed: we're building that list, and rated films carry a year that
  // already disambiguates them.
  private async resolveLanguages(rated: RatedMovie[]): Promise<string[]> {
    const languages: string[] = [];
    for (const m of rated) {
      const movie = await this.lookup.execute({ title: m.title, year: m.year });
      if (movie?.language) languages.push(movie.language);
    }
    return languages;
  }
}
