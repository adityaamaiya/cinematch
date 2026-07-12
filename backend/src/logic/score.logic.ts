import type {
  ILogic,
  IOmdbService,
  ITmdbService,
  MovieCredits,
  OmdbInfo,
  ScoreResult,
  TasteMatch,
  WatchInfo,
} from '../types/index.js';
import { AppError } from '../lib/errors.js';
import { Profile } from '../models/profile.model.js';
import { TtlCache } from '../lib/ttlCache.js';
import { verdictBand } from '../lib/affinity.js';
import type { MovieLookup } from './movieLookup.js';
import type { LlmTaste } from './tasteLlm.logic.js';

export interface ScoreInput {
  title: string;
  year?: number;
  userKey: string;
}

// ponytail: single country for now (user is in India); make it a request/env param if needed.
const WATCH_COUNTRY = 'IN';
// Where-to-watch drifts (a title leaves Netflix); trailers/credits don't. 6h is a fine trade.
const EXTRAS_TTL_MS = 6 * 60 * 60 * 1000;

export class ScoreLogic implements ILogic<ScoreInput, ScoreResult> {
  private readonly watchCache = new TtlCache<WatchInfo | null>(EXTRAS_TTL_MS);
  private readonly trailerCache = new TtlCache<string | undefined>(EXTRAS_TTL_MS);
  private readonly creditsCache = new TtlCache<MovieCredits>(EXTRAS_TTL_MS);
  private readonly omdbCache = new TtlCache<OmdbInfo | null>(EXTRAS_TTL_MS);
  private readonly tasteCache = new TtlCache<TasteMatch | null>(EXTRAS_TTL_MS);

  constructor(
    private readonly lookup: MovieLookup,
    private readonly tmdb: ITmdbService,
    private readonly omdb: IOmdbService,
    // Optional LLM taste mode; when absent, no taste line is shown.
    private readonly llmTaste?: LlmTaste,
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
    const [watch, officialTrailer, credits, omdb, onWatchlist] = await Promise.all([
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

    // Verdict = objective TMDB band. Unreleased titles have no real rating yet → no verdict (the
    // popup shows the release date instead). Only an explicit false counts as unreleased.
    const released = movie.released !== false;
    const verdict = released ? verdictBand(movie.rating) : 'Skip';

    // Taste line = LLM only (no statistical fallback). Computed even for unreleased/unrated titles —
    // the model predicts from story/director/cast, which doesn't need a rating to exist yet. Cached
    // per title so repeat views don't re-hit Gemini; on any error → no taste line.
    let tasteMatch: TasteMatch | null = null;
    if (this.llmTaste) {
      tasteMatch = await this.tasteCache
        .remember(`${cacheKey}:llm`, () =>
          this.llmTaste!.execute({
            movie,
            director: credits.director,
            leadActor: credits.leadActor,
          }),
        )
        .catch(() => null);
    }

    return {
      title: movie.title,
      year: movie.year,
      type: mediaType === 'tv' ? 'Show' : 'Movie',
      verdict,
      tmdbRating: movie.rating,
      voteCount: movie.voteCount,
      tasteMatch,
      posterUrl: movie.posterUrl,
      trailerUrl: officialTrailer ?? this.youtubeSearchUrl(movie.title, movie.year),
      watch: watch as WatchInfo | null,
      director: credits.director,
      leadActor: credits.leadActor,
      awards: omdb?.awards,
      imdbRating: omdb?.imdbRating,
      imdbVotes: omdb?.imdbVotes,
      rottenTomatoes: omdb?.rottenTomatoes,
      metascore: omdb?.metascore,
      released,
      releaseDate: movie.releaseDate,
      language: movie.language,
      onWatchlist,
    };
  }

  // Fallback when TMDB has no official trailer: a YouTube search for "<title> <year> trailer".
  private youtubeSearchUrl(title: string, year?: number): string {
    const q = `${title} ${year ?? ''} trailer`.trim();
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  }
}
