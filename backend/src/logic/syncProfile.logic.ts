import type { ILogic, ITmdbService, MovieCredits, RatedMovie, WatchlistMovie } from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import { buildAffinities, rankLanguages, VERDICT_WEIGHT, type RatedSignals } from '../lib/affinity.js';
import type { MovieLookup } from './movieLookup.js';

export interface SyncProfileInput {
  userKey: string;
  ratedMovies: RatedMovie[];
  watchlist: WatchlistMovie[];
}

export interface SyncProfileResult {
  ratedCount: number;
  watchlistCount: number;
  genreCount: number;
  directorCount: number;
  actorCount: number;
  languageCount: number;
}

export class SyncProfileLogic implements ILogic<SyncProfileInput, SyncProfileResult> {
  constructor(
    private readonly lookup: MovieLookup,
    private readonly tmdb: ITmdbService,
  ) {}

  async execute(input: SyncProfileInput): Promise<SyncProfileResult> {
    const films = await this.resolveFilms(input.ratedMovies);
    const affinities = buildAffinities(films);
    const languagePriority = rankLanguages(films);
    await Profile.upsertProfile(input.userKey, {
      ratedMovies: input.ratedMovies,
      watchlist: input.watchlist,
      languagePriority,
      ...affinities,
    });
    return {
      ratedCount: input.ratedMovies.length,
      watchlistCount: input.watchlist.length,
      genreCount: Object.keys(affinities.genreAffinity).length,
      directorCount: Object.keys(affinities.directorAffinity).length,
      actorCount: Object.keys(affinities.actorAffinity).length,
      languageCount: languagePriority.length,
    };
  }

  // Resolve each rated film to genres + director + lead actor + language.
  // ponytail: sequential TMDB lookups + credits (both cached) — fine for a one-off sync; parallelise
  // if 500+ syncs ever get slow. This is why we re-seed from the server, not through nginx (504s).
  // No preferredLanguages passed to the lookup here: we're building that list, and rated films carry
  // a year that already disambiguates them.
  private async resolveFilms(rated: RatedMovie[]): Promise<RatedSignals[]> {
    const films: RatedSignals[] = [];
    for (const m of rated) {
      const movie = await this.lookup.execute({ title: m.title, year: m.year });
      if (!movie) continue;
      const credits = await this.tmdb
        .credits(movie.tmdbId, movie.mediaType ?? 'movie')
        .catch((): MovieCredits => ({}));
      films.push({
        weight: VERDICT_WEIGHT[m.verdict],
        genres: movie.genres,
        director: credits.director,
        leadActor: credits.leadActor,
        language: movie.language,
      });
    }
    return films;
  }
}
