// Taste profile: rated movies + watchlist + language priority. Keyed so a fork can hold several
// users. All DB access is via the statics below — no separate repository layer.
import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';
import type { ContentType, RatedMovie, Verdict, WatchlistMovie } from '../types/index.js';

/** Default key when the deployment only tracks one person (this repo's owner). */
export const DEFAULT_PROFILE_KEY = 'default';

export interface ProfileAttrs {
  userKey: string;
  ratedMovies: RatedMovie[];
  watchlist: WatchlistMovie[];
  /** Languages (ISO 639-1) the user watches, most-watched first — breaks same-name-title ties. */
  languagePriority: string[];
  /** New ratings added since the last taste-profile regen — drives the auto-regen threshold. */
  ratingsSinceRegen: number;
  /** Bumped on every regen; keys the persistent taste cache so a fresh profile busts stale lines. */
  tasteVersion: number;
}

interface ProfileDoc extends ProfileAttrs, mongoose.Document {}

// --- statics ---
interface ProfileModel extends Model<ProfileDoc> {
  /** Insert or replace the profile for a user, return the saved doc. */
  upsertProfile(
    userKey: string,
    data: { ratedMovies: RatedMovie[]; watchlist: WatchlistMovie[]; languagePriority: string[] },
  ): Promise<HydratedDocument<ProfileDoc>>;
  /** Return the user's rated movies, or [] if no profile. */
  getRatedMovies(userKey: string): Promise<RatedMovie[]>;
  /** Replace the whole ratings array in place (backfill script only — leaves other fields alone). */
  setRatedMovies(userKey: string, ratedMovies: RatedMovie[]): Promise<void>;
  /** Replace the whole watchlist in place (backfill script only). */
  setWatchlist(userKey: string, watchlist: WatchlistMovie[]): Promise<void>;
  /** Add/replace a rating (idempotent by title+year). Creates the profile if absent. Returns the
   * new `ratingsSinceRegen` count so the caller can decide whether to trigger a regen. */
  addRating(userKey: string, item: RatedMovie): Promise<number>;
  /** The user's verdict for a title+year, or null if unrated. */
  getRating(userKey: string, title: string, year?: number): Promise<Verdict | null>;
  /** Zero the since-regen counter (called right after a successful regen). */
  resetRegenCounter(userKey: string): Promise<void>;
  /** Increment + return the taste-profile version (called on each regen). */
  bumpTasteVersion(userKey: string): Promise<number>;
  /** Current taste-profile version (0 if no profile) — read at boot to seed the ref. */
  getTasteVersion(userKey: string): Promise<number>;
  /** Return the user's most-watched-first language list, or [] if no profile. */
  findLanguagePriority(userKey: string): Promise<string[]>;
  /** Add a title to the watchlist (idempotent by title+year). Creates the profile if absent. */
  addToWatchlist(userKey: string, item: WatchlistMovie): Promise<void>;
  /** Remove a title from the watchlist by title+year. */
  removeFromWatchlist(userKey: string, title: string, year?: number): Promise<void>;
  /** Return the user's watchlist (newest first), or [] if no profile. */
  getWatchlist(userKey: string): Promise<WatchlistMovie[]>;
  /** True when title+year is already on the user's watchlist. */
  isOnWatchlist(userKey: string, title: string, year?: number): Promise<boolean>;
}

const CONTENT_TYPES: ContentType[] = ['Movie', 'Show', 'Anime'];
const VERDICTS: Verdict[] = ['Skip', 'Timepass', 'Go For It', 'Perfection'];

const ratedMovieSchema = new Schema<RatedMovie>(
  {
    title: { type: String, required: true },
    type: { type: String, enum: CONTENT_TYPES, required: true },
    year: { type: Number },
    verdict: { type: String, enum: VERDICTS, required: true },
    // Snapshot captured when rated in-app (seeded ratings have neither) — see RatedMovie.
    posterUrl: { type: String },
    ratedAt: { type: String },
  },
  { _id: false },
);

const watchlistMovieSchema = new Schema<WatchlistMovie>(
  {
    title: { type: String, required: true },
    type: { type: String, enum: CONTENT_TYPES, required: true },
    year: { type: Number },
    collectionId: { type: String, required: true },
    // Snapshot captured at add-time (see WatchlistMovie) — absent on legacy entries.
    verdict: { type: String, enum: VERDICTS },
    tmdbRating: { type: Number },
    posterUrl: { type: String },
    director: { type: String },
    releaseDate: { type: String },
    addedAt: { type: String },
  },
  { _id: false },
);

const profileSchema = new Schema<ProfileDoc, ProfileModel>(
  {
    userKey: { type: String, required: true, unique: true, index: true },
    ratedMovies: { type: [ratedMovieSchema], default: [] },
    watchlist: { type: [watchlistMovieSchema], default: [] },
    languagePriority: { type: [String], default: [] },
    ratingsSinceRegen: { type: Number, default: 0 },
    tasteVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

profileSchema.static('upsertProfile', function upsertProfile(this: ProfileModel, userKey, data) {
  return this.findOneAndUpdate(
    { userKey },
    { userKey, ...data },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();
});

profileSchema.static('getRatedMovies', async function getRatedMovies(this: ProfileModel, userKey) {
  const doc = await this.findOne({ userKey }, { ratedMovies: 1 }).lean().exec();
  return (doc?.ratedMovies as RatedMovie[] | undefined) ?? [];
});

profileSchema.static('setRatedMovies', async function setRatedMovies(this: ProfileModel, userKey, ratedMovies: RatedMovie[]) {
  await this.updateOne({ userKey }, { $set: { ratedMovies } }, { upsert: true }).exec();
});

profileSchema.static('setWatchlist', async function setWatchlist(this: ProfileModel, userKey, watchlist: WatchlistMovie[]) {
  await this.updateOne({ userKey }, { $set: { watchlist } }, { upsert: true }).exec();
});

profileSchema.static('addRating', async function addRating(this: ProfileModel, userKey, item: RatedMovie) {
  // Idempotent by title+year (mirrors addToWatchlist): drop any existing rating for the title, then
  // prepend the fresh one and bump the since-regen counter. Re-rating a title just updates the verdict.
  const match = { title: item.title, year: item.year ?? null };
  const stamped = { ...item, ratedAt: item.ratedAt ?? new Date().toISOString() };
  await this.updateOne({ userKey }, { $pull: { ratedMovies: match } }, { upsert: true }).exec();
  const doc = await this.findOneAndUpdate(
    { userKey },
    { $push: { ratedMovies: { $each: [stamped], $position: 0 } }, $inc: { ratingsSinceRegen: 1 } },
    { new: true, upsert: true, projection: { ratingsSinceRegen: 1 } },
  ).exec();
  return doc?.ratingsSinceRegen ?? 0;
});

profileSchema.static('getRating', async function getRating(this: ProfileModel, userKey, title, year) {
  const doc = await this.findOne(
    { userKey },
    { ratedMovies: { $elemMatch: { title, year: year ?? null } } },
  ).lean().exec();
  const m = (doc?.ratedMovies as RatedMovie[] | undefined)?.[0];
  return m?.verdict ?? null;
});

profileSchema.static('resetRegenCounter', async function resetRegenCounter(this: ProfileModel, userKey) {
  await this.updateOne({ userKey }, { $set: { ratingsSinceRegen: 0 } }).exec();
});

profileSchema.static('bumpTasteVersion', async function bumpTasteVersion(this: ProfileModel, userKey) {
  const doc = await this.findOneAndUpdate(
    { userKey },
    { $inc: { tasteVersion: 1 } },
    { new: true, upsert: true, projection: { tasteVersion: 1 } },
  ).exec();
  return doc?.tasteVersion ?? 0;
});

profileSchema.static('getTasteVersion', async function getTasteVersion(this: ProfileModel, userKey) {
  const doc = await this.findOne({ userKey }, { tasteVersion: 1 }).lean().exec();
  return (doc?.tasteVersion as number | undefined) ?? 0;
});

profileSchema.static(
  'findLanguagePriority',
  async function findLanguagePriority(this: ProfileModel, userKey) {
    const doc = await this.findOne({ userKey }, { languagePriority: 1 }).lean().exec();
    return (doc?.languagePriority as string[] | undefined) ?? [];
  },
);

profileSchema.static(
  'addToWatchlist',
  async function addToWatchlist(this: ProfileModel, userKey, item: WatchlistMovie) {
    // Idempotent: drop any existing entry for the same title+year, then prepend the fresh one.
    const match = { title: item.title, year: item.year ?? null };
    const stamped = { ...item, addedAt: item.addedAt ?? new Date().toISOString() };
    await this.updateOne({ userKey }, { $pull: { watchlist: match } }, { upsert: true }).exec();
    await this.updateOne({ userKey }, { $push: { watchlist: { $each: [stamped], $position: 0 } } }).exec();
  },
);

profileSchema.static(
  'removeFromWatchlist',
  async function removeFromWatchlist(this: ProfileModel, userKey, title: string, year?: number) {
    await this.updateOne({ userKey }, { $pull: { watchlist: { title, year: year ?? null } } }).exec();
  },
);

profileSchema.static('getWatchlist', async function getWatchlist(this: ProfileModel, userKey) {
  const doc = await this.findOne({ userKey }, { watchlist: 1 }).lean().exec();
  return (doc?.watchlist as WatchlistMovie[] | undefined) ?? [];
});

profileSchema.static(
  'isOnWatchlist',
  async function isOnWatchlist(this: ProfileModel, userKey, title: string, year?: number) {
    const doc = await this.exists({
      userKey,
      watchlist: { $elemMatch: { title, year: year ?? null } },
    });
    return !!doc;
  },
);

export const Profile = mongoose.model<ProfileDoc, ProfileModel>('Profile', profileSchema);
