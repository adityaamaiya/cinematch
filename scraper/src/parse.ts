// Pure normalisation from raw scraped strings → backend domain types. Unit-tested (parse.test.ts).
import type { ContentType, RatedMovie, Verdict, WatchlistMovie } from '../../backend/src/types/index.js';

const VERDICTS: Verdict[] = ['Skip', 'Timepass', 'Go For It', 'Perfection'];

export interface RawReviewCard {
  title: string;
  subtitle: string; // e.g. "Movie • 2026 • 1 day ago"
  verdict: string;
}

export interface RawWatchItem {
  title: string;
  subtitle?: string;
}

export function normalizeVerdict(text: string): Verdict | null {
  const t = text.trim().toLowerCase();
  return VERDICTS.find((v) => v.toLowerCase() === t) ?? null;
}

export function parseType(text: string): ContentType {
  const t = text.trim().toLowerCase();
  if (t.includes('anime')) return 'Anime';
  if (t.includes('movie')) return 'Movie';
  return 'Show';
}

export function parseYear(text: string): number | undefined {
  const m = text.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : undefined;
}

// "Movie • 2026 • 1 day ago" → { type, year }
export function parseSubtitle(subtitle: string): { type: ContentType; year?: number } {
  const parts = subtitle.split('•').map((s) => s.trim());
  return { type: parseType(parts[0] ?? ''), year: parseYear(subtitle) };
}

export function normalizeReview(raw: RawReviewCard): RatedMovie | null {
  const verdict = normalizeVerdict(raw.verdict);
  const title = raw.title.trim();
  if (!verdict || !title) return null;
  const { type, year } = parseSubtitle(raw.subtitle);
  return { title, type, year, verdict };
}

export function normalizeWatch(raw: RawWatchItem, collectionId: string): WatchlistMovie | null {
  const title = raw.title.trim();
  if (!title) return null;
  return { title, type: parseType(raw.subtitle ?? ''), collectionId };
}
