// Shared contracts for the whole backend: response envelope, logic/service interfaces, and
// domain types. Single source of truth — consumers import from here, never redefine.

// --- Response envelope (every controller responds with this) ---

export interface ApiError {
  message: string;
  /** Stable machine-readable code, e.g. "VALIDATION_ERROR", "NOT_FOUND". */
  code: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

// --- Logic-class contract (one class per operation, all expose execute()) ---

export interface ILogic<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

// --- Domain types ---

/** The 4-point verdict scale (same labels Moctale uses). */
export type Verdict = 'Skip' | 'Timepass' | 'Go For It' | 'Perfection';

/** Content kind as Moctale labels it. */
export type ContentType = 'Movie' | 'Show' | 'Anime';

/** A movie/show the user has rated on Moctale (or seeded manually). */
export interface RatedMovie {
  title: string;
  type: ContentType;
  year?: number;
  verdict: Verdict;
}

/** A watchlist entry (no verdict — it's a "want to watch"). */
export interface WatchlistMovie {
  title: string;
  type: ContentType;
  year?: number;
  /** Where it came from: a Moctale collection id, "seed", or "manual" (added from the extension). */
  collectionId: string;
}

/** Normalised result of a TMDB lookup for one title. */
export interface TmdbMovie {
  tmdbId: number;
  /** Which TMDB namespace this id lives in — needed for /movie vs /tv sub-endpoints. */
  mediaType: 'movie' | 'tv';
  title: string;
  year?: number;
  /** TMDB vote_average, 0–10. */
  rating: number;
  /** TMDB vote_count — how many ratings back the average. ~0 = too new to trust the verdict. */
  voteCount?: number;
  /** TMDB genre names, e.g. ["Action", "Thriller"]. */
  genres: string[];
  /** TMDB original_language (ISO 639-1, e.g. "en", "hi", "ta"). Used to disambiguate same-name titles. */
  language?: string;
  posterUrl?: string;
  /** Release date (YYYY-MM-DD) if TMDB has one. */
  releaseDate?: string;
  /** True when the release date exists and is on/before today. Unreleased → no real rating yet. */
  released: boolean;
}

/** One streaming/rental service a title is available on (JustWatch data via TMDB). */
export interface WatchProvider {
  name: string;
  logoUrl?: string;
}

/**
 * Where a title can be watched in one country (JustWatch via TMDB). Per TMDB's licence we may
 * show WHO offers it + link to the TMDB watch page, but not deep-link into the provider.
 */
export interface WatchInfo {
  /** TMDB watch page for this title + country. */
  link?: string;
  /** Subscription streaming (Netflix, Prime, …). */
  flatrate: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
}

/**
 * How well a title matches the user's taste. This is SEPARATE from the verdict — the meter
 * stays objective (TMDB), this is the punchy "for you" line shown alongside it.
 */
export type TasteMatchLevel = 'strong' | 'mild' | 'mismatch';

export interface TasteMatch {
  level: TasteMatchLevel;
  /** Attention-grabbing copy to render, e.g. "🔥 Peak you — exactly your taste". */
  message: string;
}

/** What GET /score returns. */
export interface ScoreResult {
  title: string;
  year?: number;
  /** Objective verdict from the TMDB rating band — never altered by the profile. */
  verdict: Verdict;
  tmdbRating: number;
  /** How many TMDB votes back the rating. Low + released → popup shows "too new" instead of a verdict. */
  voteCount?: number;
  /** Personalised taste-match line, or null when there's no profile / no genre overlap. */
  tasteMatch: TasteMatch | null;
  posterUrl?: string;
  /** YouTube trailer URL — an official TMDB trailer, else a YouTube search link. */
  trailerUrl?: string;
  /** Where to watch (one country), or null when TMDB has no availability data. */
  watch: WatchInfo | null;
  /** Director, when TMDB credits have one. */
  director?: string;
  /** Top-billed cast member, when available. */
  leadActor?: string;
  /** Awards summary from OMDb (e.g. "Won 4 Oscars..."), when OMDb is configured + has data. */
  awards?: string;
  /** IMDb rating string from OMDb (e.g. "8.8"), when available. */
  imdbRating?: string;
  /** False when the title isn't released yet — the popup shows the date instead of a verdict. */
  released: boolean;
  /** Release date (YYYY-MM-DD) if known. */
  releaseDate?: string;
  /** Original language (ISO 639-1) of the matched title — shown so same-name picks are transparent. */
  language?: string;
  /** True when this title is already on the user's watchlist. */
  onWatchlist: boolean;
}

/** A single recommendation (grid-page fallback). */
export interface Recommendation {
  title: string;
  year?: number;
  verdict: Verdict;
  tmdbRating: number;
  posterUrl?: string;
}

/** A watchlist entry scored + taste-matched for the "My list" view. */
export interface WatchlistScored {
  title: string;
  year?: number;
  type: ContentType;
  verdict: Verdict;
  tmdbRating: number;
  tasteMatch: TasteMatch | null;
  posterUrl?: string;
  director?: string;
  /** False when the title isn't out yet — the list shows "Upcoming" instead of a verdict. */
  released: boolean;
}

/** Mood buckets the extension can pick from; each maps to TMDB genres. */
export type Mood = 'chill' | 'intense' | 'feelgood' | 'mindbender' | 'classic';

/**
 * Genre-affinity map: genre name → signed preference relative to the user's mean.
 * Positive = liked more than average, negative = liked less. Empty for no profile.
 */
export type GenreAffinity = Record<string, number>;

/** Same shape as GenreAffinity, but keyed by a person's name (director or actor). */
export type PersonAffinity = Record<string, number>;

/** All three taste signals derived on sync: broad (genre) + personal (director/actor). */
export interface Affinities {
  genreAffinity: GenreAffinity;
  directorAffinity: PersonAffinity;
  actorAffinity: PersonAffinity;
}

// --- Service contracts (third-party clients only) ---

export interface ITmdbService {
  /**
   * Search by title, return the best-matching movie/show enriched with rating + genres.
   * `preferredLanguages` (ISO 639-1, priority order) breaks ties between same-name titles —
   * used so e.g. a Bollywood viewer gets the Hindi cut over a more-popular English one.
   */
  searchTitle(title: string, year?: number, preferredLanguages?: string[]): Promise<TmdbMovie | null>;
  /** Discover candidates by TMDB genre id(s), sorted by rating. */
  discover(genreIds: number[], limit: number): Promise<TmdbMovie[]>;
  /** Where the title streams/rents/buys in one country (JustWatch data). Null if none. */
  watchProviders(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    country: string,
  ): Promise<WatchInfo | null>;
  /** Best YouTube trailer URL for the title, or undefined if TMDB has none. */
  trailerUrl(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<string | undefined>;
  /** Director + top-billed actor from TMDB credits. Either field may be undefined. */
  credits(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<MovieCredits>;
}

/** Director + lead actor for a title. */
export interface MovieCredits {
  director?: string;
  leadActor?: string;
}

/** Awards + IMDb rating from OMDb (omdbapi.com). */
export interface OmdbInfo {
  awards?: string;
  imdbRating?: string;
}

export interface IOmdbService {
  /** Look up awards + IMDb rating by title (+ year). Returns null when unconfigured or not found. */
  lookup(title: string, year?: number): Promise<OmdbInfo | null>;
}

// --- Logger contract ---

export interface ILogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}
