// Entry point: connect Mongo, build the real TMDB client, then start the server.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { Logger } from './lib/logger.js';
import type { ILlm, ILlmProvider, TasteProfileRef } from './types/index.js';
import { TmdbService } from './services/tmdb.service.js';
import { OmdbService } from './services/omdb.service.js';
import { GeminiService } from './services/gemini.service.js';
import { GroqService } from './services/groq.service.js';
import { LlmChain } from './services/llmChain.js';
import { DEFAULT_PROFILE_KEY, Profile } from './models/profile.model.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
// backend/taste-profile.md — one level above src/ (dev) and dist/ (prod) alike.
const TASTE_PROFILE_PATH = fileURLToPath(new URL('../taste-profile.md', import.meta.url));
const logger = new Logger('boot');

async function main(): Promise<void> {
  await mongoose.connect(env.mongodbUri);
  logger.info('Connected to MongoDB');

  const tmdb = new TmdbService(TMDB_BASE_URL, env.tmdbReadToken, new Logger('tmdb'));
  const omdb = new OmdbService(env.omdbApiKey, new Logger('omdb'));
  // Optional LLM taste mode — needs both a provider and the precomputed taste profile. Gemini first,
  // then Groq as a cross-provider fallback when every Gemini model is quota-exhausted.
  const providers: ILlmProvider[] = [];
  if (env.geminiApiKey) providers.push(new GeminiService(env.geminiApiKey, env.geminiModel, new Logger('gemini')));
  if (env.groqApiKey) providers.push(new GroqService(env.groqApiKey, env.groqModel, new Logger('groq')));
  const llm: ILlm | undefined = providers.length ? new LlmChain(providers, new Logger('llm')) : undefined;
  // Mutable ref: prose seeded from the file, version read from Mongo so taste-cache keys stay stable
  // across restarts. The regen mutates both in-process; a fresh deployment starts with empty prose
  // (taste line stays off) until the first regen fills it.
  const tasteRef: TasteProfileRef = {
    text: readTasteProfile() ?? '',
    version: await Profile.getTasteVersion(DEFAULT_PROFILE_KEY).catch(() => 0),
  };
  if (llm && !tasteRef.text) {
    logger.warn('LLM key set but taste-profile.md missing/empty — taste line off until first regen');
  }
  const app = createApp({
    tmdb,
    omdb,
    llm,
    tasteRef,
    tasteProfilePath: TASTE_PROFILE_PATH,
    regenEvery: env.tasteRegenEvery,
    syncToken: env.syncToken,
  });

  app.listen(env.port, () => {
    logger.info(`CineMatch backend listening on http://localhost:${env.port}`);
  });
}

function readTasteProfile(): string | undefined {
  try {
    return readFileSync(TASTE_PROFILE_PATH, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

main().catch((err) => {
  logger.error('Failed to start', err);
  process.exit(1);
});
