import type {
  Affinities,
  ILogic,
  ITmdbService,
  MovieCredits,
  PersonAffinity,
  RatedMovie,
  Verdict,
  WatchlistMovie,
} from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import { mean, round2 } from '../lib/utils.js';
import type { MovieLookup } from './movieLookup.js';

const VERDICT_WEIGHT: Record<Verdict, number> = {
  Skip: 1,
  Timepass: 2,
  'Go For It': 3,
  Perfection: 4,
};

// Ignore genres with too few samples — one 5-star noir shouldn't make "Crime" a top genre.
const GENRE_MIN_SAMPLES = 3;
// Directors/actors need fewer samples to matter (a 2-film Nolan streak is a real signal), but
// still >1 so a single lucky pick doesn't dominate.
const PERSON_MIN_SAMPLES = 2;

/** One rated film reduced to the signals affinity is built from. */
export interface RatedSignals {
  weight: number;
  genres: string[];
  director?: string;
  leadActor?: string;
  language?: string;
}

// Languages the user watches enough to matter (≥ this many rated films), most-watched first.
// Used to break same-name-title ties in TMDB search. Noise guard drops one-off languages.
const LANGUAGE_MIN_COUNT = 3;

export function rankLanguages(films: RatedSignals[]): string[] {
  const counts: Record<string, number> = {};
  for (const f of films) if (f.language) counts[f.language] = (counts[f.language] ?? 0) + 1;
  const ranked = Object.entries(counts)
    .filter(([, n]) => n >= LANGUAGE_MIN_COUNT)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
  // Demote English to the back: TMDB popularity already skews toward English/Hollywood, so for a
  // same-name tie we want the user's regional languages to win first; English still beats a wholly
  // unlisted language, and a genuinely English title resolves via popularity anyway.
  const nonEn = ranked.filter((l) => l !== 'en');
  return nonEn.length < ranked.length ? [...nonEn, 'en'] : ranked;
}

// Affinity = per-key mean verdict-weight minus the user's overall mean (relative preference, to
// cancel the cinephile bias of rating almost everything highly). Same math for genre + person maps.
// NB: a fixed baseline shift (e.g. toward the scale midpoint to "add absolute verdict level") only
// translates every score by a constant — it never changes rank, so it's equivalent to moving the
// scorer cutoffs and buys nothing. Ranking is set by the RELATIVE spread; tune cutoffs instead.
// Pure + sync so the calibration script (scripts/calibrate-affinity.ts) can reuse it DB/HTTP-free.
export function buildAffinities(films: RatedSignals[]): Affinities {
  const byGenre: Record<string, number[]> = {};
  const byDirector: Record<string, number[]> = {};
  const byActor: Record<string, number[]> = {};
  const allWeights: number[] = [];

  for (const f of films) {
    allWeights.push(f.weight);
    for (const g of f.genres) (byGenre[g] ??= []).push(f.weight);
    if (f.director) (byDirector[f.director] ??= []).push(f.weight);
    if (f.leadActor) (byActor[f.leadActor] ??= []).push(f.weight);
  }

  const empty = { genreAffinity: {}, directorAffinity: {}, actorAffinity: {} };
  if (allWeights.length === 0) return empty;
  const baseline = mean(allWeights);

  const reduce = (m: Record<string, number[]>, minSamples: number): PersonAffinity => {
    const out: PersonAffinity = {};
    for (const [key, weights] of Object.entries(m)) {
      if (weights.length < minSamples) continue;
      out[key] = round2(mean(weights) - baseline);
    }
    return out;
  };

  return {
    genreAffinity: reduce(byGenre, GENRE_MIN_SAMPLES),
    directorAffinity: reduce(byDirector, PERSON_MIN_SAMPLES),
    actorAffinity: reduce(byActor, PERSON_MIN_SAMPLES),
  };
}

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
