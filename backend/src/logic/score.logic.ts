import type {
  ILogic,
  IOmdbService,
  ITmdbService,
  MovieCredits,
  OmdbInfo,
  ScoreResult,
  WatchInfo,
} from '../types/index.js';
import { AppError } from '../lib/errors.js';
import { Profile } from '../models/profile.model.js';
import { TtlCache } from '../lib/ttlCache.js';
import type { MovieLookup } from './movieLookup.js';
import type { Scorer } from './scorer.logic.js';

export interface ScoreInput {
  title: string;
  year?: number;
  userKey: string;
}

// ponytail: single country for now (user is in India); make it a request/env param if needed.
const WATCH_COUNTRY = 'IN';
// Where-to-watch drifts (a title leaves Netflix); trailers/credits don't. 6h is a fine trade.
const EXTRAS_TTL_MS = 6 * 60 * 60 * 1000;

function youtubeSearchUrl(title: string, year?: number): string {
  const q = `${title} ${year ?? ''} trailer`.trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

export class ScoreLogic implements ILogic<ScoreInput, ScoreResult> {
  private readonly watchCache = new TtlCache<WatchInfo | null>(EXTRAS_TTL_MS);
  private readonly trailerCache = new TtlCache<string | undefined>(EXTRAS_TTL_MS);
  private readonly creditsCache = new TtlCache<MovieCredits>(EXTRAS_TTL_MS);
  private readonly omdbCache = new TtlCache<OmdbInfo | null>(EXTRAS_TTL_MS);

  constructor(
    private readonly lookup: MovieLookup,
    private readonly scorer: Scorer,
    private readonly tmdb: ITmdbService,
    private readonly omdb: IOmdbService,
  ) {}

  async execute(input: ScoreInput): Promise<ScoreResult> {
    // Language priority disambiguates same-name titles (e.g. the Hindi cut over a more-popular
    // English one) toward what this user actually watches. Absent profile → [] → popularity as before.
    const preferredLanguages = await Profile.findLanguagePriority(input.userKey).catch(() => []);
    const movie = await this.lookup.execute({
      title: input.title,
      year: input.year,
      preferredLanguages,
    });
    if (!movie) throw AppError.notFound(`No TMDB match for "${input.title}"`, 'MOVIE_NOT_FOUND');

    // Verdict/taste are core; everything else is a cached extra that must never break a score.
    // Default mediaType for entries cached before it existed (and defensively for odd search hits).
    const mediaType = movie.mediaType ?? 'movie';
    const cacheKey = `${mediaType}:${movie.tmdbId}`;
    const omdbKey = `${movie.title.toLowerCase()}|${movie.year ?? ''}`;
    const [affinities, watch, officialTrailer, credits, omdb, onWatchlist] = await Promise.all([
      Profile.findAffinities(input.userKey),
      this.watchCache
        .remember(`${cacheKey}:${WATCH_COUNTRY}`, () =>
          this.tmdb.watchProviders(movie.tmdbId, mediaType, WATCH_COUNTRY),
        )
        .catch(() => null),
      this.trailerCache
        .remember(cacheKey, () => this.tmdb.trailerUrl(movie.tmdbId, mediaType))
        .catch(() => undefined),
      this.creditsCache
        .remember(cacheKey, () => this.tmdb.credits(movie.tmdbId, mediaType))
        .catch((): MovieCredits => ({})),
      this.omdbCache.remember(omdbKey, () => this.omdb.lookup(movie.title, movie.year)).catch(() => null),
      Profile.isOnWatchlist(input.userKey, movie.title, movie.year).catch(() => false),
    ]);

    // Unreleased titles have no real rating yet → no verdict/taste; the popup shows the date instead.
    // Only an explicit false counts as unreleased (entries cached before `released` existed are
    // undefined → treat as released, since they carry a real rating).
    const released = movie.released !== false;
    const scored = released
      ? await this.scorer.execute({
          movie,
          affinity: affinities.genreAffinity,
          director: credits.director,
          leadActor: credits.leadActor,
          directorAffinity: affinities.directorAffinity,
          actorAffinity: affinities.actorAffinity,
        })
      : { verdict: 'Skip' as const, tasteMatch: null };

    return {
      title: movie.title,
      year: movie.year,
      verdict: scored.verdict,
      tmdbRating: movie.rating,
      tasteMatch: scored.tasteMatch,
      posterUrl: movie.posterUrl,
      trailerUrl: officialTrailer ?? youtubeSearchUrl(movie.title, movie.year),
      watch: watch as WatchInfo | null,
      director: credits.director,
      leadActor: credits.leadActor,
      awards: omdb?.awards,
      imdbRating: omdb?.imdbRating,
      released,
      releaseDate: movie.releaseDate,
      language: movie.language,
      onWatchlist,
    };
  }
}
