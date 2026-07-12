// Entry point: connect Mongo, build the real TMDB client, then start the server.
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { Logger } from './lib/logger.js';
import { TmdbService } from './services/tmdb.service.js';
import { OmdbService } from './services/omdb.service.js';
import { GeminiService } from './services/gemini.service.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const logger = new Logger('boot');

async function main(): Promise<void> {
  await mongoose.connect(env.mongodbUri);
  logger.info('Connected to MongoDB');

  const tmdb = new TmdbService(TMDB_BASE_URL, env.tmdbReadToken, new Logger('tmdb'));
  const omdb = new OmdbService(env.omdbApiKey, new Logger('omdb'));
  // Optional LLM taste mode — only when a key is configured.
  const gemini = env.geminiApiKey
    ? new GeminiService(env.geminiApiKey, env.geminiModel, new Logger('gemini'))
    : undefined;
  const app = createApp({ tmdb, omdb, gemini, syncToken: env.syncToken });

  app.listen(env.port, () => {
    logger.info(`CineMatch backend listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  logger.error('Failed to start', err);
  process.exit(1);
});
