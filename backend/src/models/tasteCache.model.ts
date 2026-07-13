// Persists the LLM taste-match line per title so a deploy/restart doesn't re-hit Gemini. Mirrors
// ScoreCache. The key embeds the taste-profile version, so a regen (which bumps the version) leaves
// every old entry unreferenced — a fresher profile always recomputes, and stale entries TTL out.
import mongoose, { Schema, type Model } from 'mongoose';
import type { TasteMatch } from '../types/index.js';

/** Cache lifetime. A profile change busts entries via the version key; the TTL just reaps them. */
const TTL_SECONDS = 30 * 24 * 60 * 60;

interface TasteCacheDoc extends mongoose.Document {
  /** e.g. "movie:27205:v3" — mediaType:tmdbId:version. */
  cacheKey: string;
  taste: TasteMatch | null; // null = "model said none" (cache the no-line answer too)
  createdAt: Date;
}

interface TasteCacheModel extends Model<TasteCacheDoc> {
  /** Cached taste for a key, or undefined if not cached. `null` taste = cached "no line". */
  get(cacheKey: string): Promise<TasteMatch | null | undefined>;
  put(cacheKey: string, taste: TasteMatch | null): Promise<void>;
}

const tasteCacheSchema = new Schema<TasteCacheDoc, TasteCacheModel>({
  cacheKey: { type: String, required: true, unique: true, index: true },
  taste: { type: Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now, expires: TTL_SECONDS },
});

tasteCacheSchema.static('get', async function get(this: TasteCacheModel, cacheKey) {
  const doc = await this.findOne({ cacheKey }).lean().exec();
  if (!doc) return undefined;
  return (doc.taste as TasteMatch | null) ?? null;
});

tasteCacheSchema.static('put', async function put(this: TasteCacheModel, cacheKey, taste) {
  await this.findOneAndUpdate(
    { cacheKey },
    { cacheKey, taste, createdAt: new Date() },
    { upsert: true },
  ).exec();
});

export const TasteCache = mongoose.model<TasteCacheDoc, TasteCacheModel>('TasteCache', tasteCacheSchema);
