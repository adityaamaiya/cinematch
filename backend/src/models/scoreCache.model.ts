// Caches TMDB lookups (incl. misses) to avoid re-hitting the API and to survive rate limits
// when enriching a 500+ movie profile. Entries expire via a TTL index. Access via statics.
import mongoose, { Schema, type Model } from 'mongoose';
import type { TmdbMovie } from '../types/index.js';

/** Cache lifetime — TMDB ratings drift slowly, a week is plenty. */
const TTL_SECONDS = 7 * 24 * 60 * 60;

interface ScoreCacheDoc extends mongoose.Document {
  /** Normalised lookup key, e.g. "inception|2010". */
  cacheKey: string;
  movie: TmdbMovie | null; // null = "TMDB had no match" (cache the miss too)
  createdAt: Date;
}

interface ScoreCacheModel extends Model<ScoreCacheDoc> {
  /** Return the cached movie for a key, or undefined if not cached. `null` movie = cached miss. */
  get(cacheKey: string): Promise<TmdbMovie | null | undefined>;
  /** Store (or refresh) a lookup result. */
  put(cacheKey: string, movie: TmdbMovie | null): Promise<void>;
}

const scoreCacheSchema = new Schema<ScoreCacheDoc, ScoreCacheModel>({
  cacheKey: { type: String, required: true, unique: true, index: true },
  movie: { type: Schema.Types.Mixed, default: null },
  // TTL index: Mongo removes the doc TTL_SECONDS after createdAt.
  createdAt: { type: Date, default: Date.now, expires: TTL_SECONDS },
});

scoreCacheSchema.static('get', async function get(this: ScoreCacheModel, cacheKey) {
  const doc = await this.findOne({ cacheKey }).lean().exec();
  if (!doc) return undefined;
  return (doc.movie as TmdbMovie | null) ?? null;
});

scoreCacheSchema.static('put', async function put(this: ScoreCacheModel, cacheKey, movie) {
  await this.findOneAndUpdate(
    { cacheKey },
    { cacheKey, movie, createdAt: new Date() },
    { upsert: true },
  ).exec();
});

export const ScoreCache = mongoose.model<ScoreCacheDoc, ScoreCacheModel>('ScoreCache', scoreCacheSchema);
