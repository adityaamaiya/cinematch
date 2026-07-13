// Backfill the poster + director snapshot for ratings that lack them (the seeded Moctale ratings, and
// any rated before director snapshotting). For each, resolve the correct title on TMDB by name + year
// (using the profile's language priority to disambiguate same-name titles) and store posterUrl +
// director. Lookups go through ScoreCache; runs sequentially so it's safe under TMDB's limits.
//
// Usage: npm run backfill-posters
import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Logger } from '../src/lib/logger.js';
import type { MovieCredits, RatedMovie } from '../src/types/index.js';
import { TmdbService } from '../src/services/tmdb.service.js';
import { MovieLookup } from '../src/logic/movieLookup.js';
import { DEFAULT_PROFILE_KEY, Profile } from '../src/models/profile.model.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const logger = new Logger('backfill');

async function main(): Promise<void> {
  await mongoose.connect(env.mongodbUri);
  try {
    const tmdb = new TmdbService(TMDB_BASE_URL, env.tmdbReadToken, new Logger('tmdb'));
    const lookup = new MovieLookup(tmdb, new Logger('lookup'));
    const preferredLanguages = await Profile.findLanguagePriority(DEFAULT_PROFILE_KEY);
    const rated = await Profile.getRatedMovies(DEFAULT_PROFILE_KEY);

    const todo = rated.filter((r) => !r.posterUrl || !r.director || !r.leadActor);
    logger.info(`${rated.length} ratings; ${todo.length} missing poster/director/lead`);

    let filled = 0;
    let missed = 0;
    const enriched: RatedMovie[] = [];
    for (const r of rated) {
      if (r.posterUrl && r.director && r.leadActor) {
        enriched.push(r);
        continue;
      }
      // Sequential (one lookup at a time) — stays far under TMDB's ~50 req/s + 20-connection limits.
      const movie = await lookup.execute({ title: r.title, year: r.year, preferredLanguages });
      if (movie) {
        const mediaType = movie.mediaType ?? 'movie';
        const credits = await tmdb.credits(movie.tmdbId, mediaType).catch((): MovieCredits => ({}));
        enriched.push({
          ...r,
          posterUrl: r.posterUrl ?? movie.posterUrl,
          director: r.director ?? credits.director,
          leadActor: r.leadActor ?? credits.leadActor,
          year: r.year ?? movie.year,
        });
        filled++;
      } else {
        enriched.push(r);
        missed++;
        logger.warn(`no TMDB match for "${r.title}"${r.year ? ` (${r.year})` : ''}`);
      }
    }

    await Profile.setRatedMovies(DEFAULT_PROFILE_KEY, enriched);
    logger.info(`done — filled ${filled}, no match ${missed}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
