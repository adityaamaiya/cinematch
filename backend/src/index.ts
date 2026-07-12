// Entry point: connect Mongo, build the real TMDB client, then start the server.
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { Logger } from './lib/logger.js';
import type { ILlm, ILlmProvider } from './types/index.js';
import { TmdbService } from './services/tmdb.service.js';
import { OmdbService } from './services/omdb.service.js';
import { GeminiService } from './services/gemini.service.js';
import { GroqService } from './services/groq.service.js';
import { LlmChain } from './services/llmChain.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
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
  const tasteProfile = readTasteProfile();
  if (llm && !tasteProfile) {
    logger.warn('LLM key set but taste-profile.md missing/empty — LLM taste off');
  }
  const app = createApp({ tmdb, omdb, llm, tasteProfile, syncToken: env.syncToken });

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
