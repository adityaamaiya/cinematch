// Zod schemas per endpoint. Controllers parse with these; invalid input becomes a 400.
import { z } from 'zod';

const contentType = z.enum(['Movie', 'Show', 'Anime']);
const verdict = z.enum(['Skip', 'Timepass', 'Go For It', 'Perfection']);
const mood = z.enum(['chill', 'intense', 'feelgood', 'mindbender', 'classic']);

export const scoreQuery = z.object({
  title: z.string().trim().min(1, 'title is required'),
  year: z.coerce.number().int().optional(),
});

export const recommendQuery = z.object({
  mood: mood.optional(),
  genre: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

export const syncProfileBody = z.object({
  ratedMovies: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        type: contentType,
        year: z.number().int().optional(),
        verdict,
      }),
    )
    .default([]),
  watchlist: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        type: contentType,
        collectionId: z.string().trim().min(1),
      }),
    )
    .default([]),
});

export type ScoreQuery = z.infer<typeof scoreQuery>;
export type RecommendQuery = z.infer<typeof recommendQuery>;
export type SyncProfileBody = z.infer<typeof syncProfileBody>;
