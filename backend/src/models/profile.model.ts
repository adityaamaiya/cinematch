// Taste profile: rated movies, watchlist, derived genre affinity. Keyed so a fork can hold
// several users. All DB access is via the statics below — no separate repository layer.
import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';
import type { ContentType, GenreAffinity, RatedMovie, Verdict, WatchlistMovie } from '../types/index.js';

/** Default key when the deployment only tracks one person (this repo's owner). */
export const DEFAULT_PROFILE_KEY = 'default';

export interface ProfileAttrs {
  userKey: string;
  ratedMovies: RatedMovie[];
  watchlist: WatchlistMovie[];
  /** genre name → signed affinity relative to the user's mean weight. */
  genreAffinity: GenreAffinity;
}

interface ProfileDoc extends ProfileAttrs, mongoose.Document {}

// --- statics ---
interface ProfileModel extends Model<ProfileDoc> {
  /** Insert or replace the profile + derived affinity for a user, return the saved doc. */
  upsertProfile(
    userKey: string,
    data: { ratedMovies: RatedMovie[]; watchlist: WatchlistMovie[]; genreAffinity: GenreAffinity },
  ): Promise<HydratedDocument<ProfileDoc>>;
  /** Return the genre-affinity map for a user, or empty object if no profile exists. */
  findAffinity(userKey: string): Promise<GenreAffinity>;
  /** Add a title to the watchlist (idempotent by title+year). Creates the profile if absent. */
  addToWatchlist(userKey: string, item: WatchlistMovie): Promise<void>;
  /** Remove a title from the watchlist by title+year. */
  removeFromWatchlist(userKey: string, title: string, year?: number): Promise<void>;
  /** Return the user's watchlist (newest first), or [] if no profile. */
  getWatchlist(userKey: string): Promise<WatchlistMovie[]>;
}

const CONTENT_TYPES: ContentType[] = ['Movie', 'Show', 'Anime'];
const VERDICTS: Verdict[] = ['Skip', 'Timepass', 'Go For It', 'Perfection'];

const ratedMovieSchema = new Schema<RatedMovie>(
  {
    title: { type: String, required: true },
    type: { type: String, enum: CONTENT_TYPES, required: true },
    year: { type: Number },
    verdict: { type: String, enum: VERDICTS, required: true },
  },
  { _id: false },
);

const watchlistMovieSchema = new Schema<WatchlistMovie>(
  {
    title: { type: String, required: true },
    type: { type: String, enum: CONTENT_TYPES, required: true },
    year: { type: Number },
    collectionId: { type: String, required: true },
  },
  { _id: false },
);

const profileSchema = new Schema<ProfileDoc, ProfileModel>(
  {
    userKey: { type: String, required: true, unique: true, index: true },
    ratedMovies: { type: [ratedMovieSchema], default: [] },
    watchlist: { type: [watchlistMovieSchema], default: [] },
    // Object of genre → number. Mongoose stores this as a plain subdocument.
    genreAffinity: { type: Schema.Types.Mixed, default: {} },
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

profileSchema.static('findAffinity', async function findAffinity(this: ProfileModel, userKey) {
  const doc = await this.findOne({ userKey }, { genreAffinity: 1 }).lean().exec();
  return (doc?.genreAffinity as GenreAffinity | undefined) ?? {};
});

profileSchema.static(
  'addToWatchlist',
  async function addToWatchlist(this: ProfileModel, userKey, item: WatchlistMovie) {
    // Idempotent: drop any existing entry for the same title+year, then prepend the fresh one.
    const match = { title: item.title, year: item.year ?? null };
    await this.updateOne({ userKey }, { $pull: { watchlist: match } }, { upsert: true }).exec();
    await this.updateOne({ userKey }, { $push: { watchlist: { $each: [item], $position: 0 } } }).exec();
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

export const Profile = mongoose.model<ProfileDoc, ProfileModel>('Profile', profileSchema);
