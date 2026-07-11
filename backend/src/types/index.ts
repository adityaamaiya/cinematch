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
  /** Which Moctale collection it came from (or "seed"). */
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
  /** TMDB genre names, e.g. ["Action", "Thriller"]. */
  genres: string[];
  posterUrl?: string;
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
  /** Personalised taste-match line, or null when there's no profile / no genre overlap. */
  tasteMatch: TasteMatch | null;
  posterUrl?: string;
  /** YouTube trailer URL, or undefined when TMDB has none. */
  trailerUrl?: string;
  /** Where to watch (one country), or null when TMDB has no availability data. */
  watch: WatchInfo | null;
}

/** A single recommendation (grid-page fallback). */
export interface Recommendation {
  title: string;
  year?: number;
  verdict: Verdict;
  tmdbRating: number;
  posterUrl?: string;
}

/** Mood buckets the extension can pick from; each maps to TMDB genres. */
export type Mood = 'chill' | 'intense' | 'feelgood' | 'mindbender' | 'classic';

/**
 * Genre-affinity map: genre name → signed preference relative to the user's mean.
 * Positive = liked more than average, negative = liked less. Empty for no profile.
 */
export type GenreAffinity = Record<string, number>;

// --- Service contracts (third-party clients only) ---

export interface ITmdbService {
  /** Search by title, return the best-matching movie/show enriched with rating + genres. */
  searchTitle(title: string, year?: number): Promise<TmdbMovie | null>;
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
}

// --- Logger contract ---

export interface ILogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}
