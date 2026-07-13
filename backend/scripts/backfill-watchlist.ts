// Backfill the /score snapshot (verdict, tmdbRating, posterUrl, director, releaseDate) onto watchlist
// entries that lack one — the legacy entries added before snapshotting (seeded). After this, the
// watchlist list view is fully snapshot-driven (no TMDB) and verdict-filterable. Lookups go through
// ScoreCache, and this runs sequentially (small bursts), so it's safe under TMDB's limits.
//
// Usage: npm run backfill-watchlist
import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Logger } from '../src/lib/logger.js';
import type { MovieCredits, WatchlistMovie } from '../src/types/index.js';
import { TmdbService } from '../src/services/tmdb.service.js';
import { MovieLookup } from '../src/logic/movieLookup.js';
import { verdictBand } from '../src/lib/affinity.js';
import { DEFAULT_PROFILE_KEY, Profile } from '../src/models/profile.model.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const logger = new Logger('backfill-wl');
const hasSnapshot = (m: WatchlistMovie): boolean =>
  m.verdict != null || m.posterUrl != null || m.tmdbRating != null;

async function main(): Promise<void> {
  await mongoose.connect(env.mongodbUri);
  try {
    const tmdb = new TmdbService(TMDB_BASE_URL, env.tmdbReadToken, new Logger('tmdb'));
    const lookup = new MovieLookup(tmdb, new Logger('lookup'));
    const preferredLanguages = await Profile.findLanguagePriority(DEFAULT_PROFILE_KEY);
    const watchlist = await Profile.getWatchlist(DEFAULT_PROFILE_KEY);

    const todo = watchlist.filter((m) => !hasSnapshot(m));
    logger.info(`${watchlist.length} watchlist items; ${todo.length} missing a snapshot`);

    let filled = 0;
    let missed = 0;
    const enriched: WatchlistMovie[] = [];
    for (const m of watchlist) {
      if (hasSnapshot(m)) {
        enriched.push(m);
        continue;
      }
      const movie = await lookup.execute({ title: m.title, year: m.year, preferredLanguages });
      if (!movie) {
        enriched.push(m);
        missed++;
        logger.warn(`no TMDB match for "${m.title}"${m.year ? ` (${m.year})` : ''}`);
        continue;
      }
      const mediaType = movie.mediaType ?? 'movie';
      const credits = await tmdb.credits(movie.tmdbId, mediaType).catch((): MovieCredits => ({}));
      const released = movie.released !== false;
      enriched.push({
        ...m,
        year: m.year ?? movie.year,
        verdict: released ? verdictBand(movie.rating) : 'Skip',
        tmdbRating: movie.rating,
        posterUrl: movie.posterUrl,
        director: credits.director,
        releaseDate: movie.releaseDate,
        addedAt: m.addedAt ?? new Date().toISOString(),
      });
      filled++;
    }

    await Profile.setWatchlist(DEFAULT_PROFILE_KEY, enriched);
    logger.info(`done — filled ${filled}, no match ${missed}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
