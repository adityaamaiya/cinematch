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
  title: string;
  year?: number;
  /** TMDB vote_average, 0–10. */
  rating: number;
  /** TMDB genre names, e.g. ["Action", "Thriller"]. */
  genres: string[];
  posterUrl?: string;
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
}

// --- Logger contract ---

export interface ILogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}
