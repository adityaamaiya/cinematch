// Static mood → TMDB genre-id map, plus genre-name → id lookup. No ML — just sensible buckets.
import type { Mood } from '../types/index.js';

export const MOOD_GENRES: Record<Mood, number[]> = {
  chill: [35, 10749, 10751], // Comedy, Romance, Family
  intense: [53, 28, 80], // Thriller, Action, Crime
  feelgood: [35, 10402, 12], // Comedy, Music, Adventure
  mindbender: [878, 9648, 53], // Sci-Fi, Mystery, Thriller
  classic: [18, 36, 10752], // Drama, History, War
};

export const GENRE_NAME_TO_ID: Record<string, number> = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  'science fiction': 878,
  'sci-fi': 878,
  thriller: 53,
  war: 10752,
  western: 37,
};

/** Fallback when no mood/genre/profile signal is available. */
export const DEFAULT_GENRE_IDS = [18]; // Drama
