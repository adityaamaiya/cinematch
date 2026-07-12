// Entry point: connect Mongo, build the real TMDB client, then start the server.
import { readFileSync } from 'node:fs';
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
  // Optional LLM taste mode — needs both a key and the precomputed taste profile.
  const gemini = env.geminiApiKey
    ? new GeminiService(env.geminiApiKey, env.geminiModel, new Logger('gemini'))
    : undefined;
  const tasteProfile = readTasteProfile();
  if (gemini && !tasteProfile) {
    logger.warn('GEMINI_API_KEY set but taste-profile.md missing/empty — LLM taste off');
  }
  const app = createApp({ tmdb, omdb, gemini, tasteProfile, syncToken: env.syncToken });

  app.listen(env.port, () => {
    logger.info(`CineMatch backend listening on http://localhost:${env.port}`);
  });
}

// backend/taste-profile.md — one level above src/ (dev) and dist/ (prod build) alike.
function readTasteProfile(): string | undefined {
  try {
    const text = readFileSync(new URL('../taste-profile.md', import.meta.url), 'utf8').trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

main().catch((err) => {
  logger.error('Failed to start', err);
  process.exit(1);
});
