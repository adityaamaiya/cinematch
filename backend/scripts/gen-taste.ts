// Regenerate backend/taste-profile.md from the ratings currently in Mongo, using the LLM chain
// (Gemini free → Groq fallback) with a large output budget. One-time migration + manual/cron runs.
//
// Exemplar: if taste-profile.opus.md exists (the preserved Claude-Opus baseline), it's fed as the
// style/depth template so the regen matches its shape; otherwise the current taste-profile.md is.
// Writes the fresh prose to taste-profile.md and bumps the Mongo tasteVersion (busts the cache).
//
// Usage: npm run gen-taste
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Logger } from '../src/lib/logger.js';
import type { ILlmProvider, TasteProfileRef } from '../src/types/index.js';
import { GeminiService } from '../src/services/gemini.service.js';
import { GroqService } from '../src/services/groq.service.js';
import { LlmChain } from '../src/services/llmChain.js';
import { GenerateTasteLogic } from '../src/logic/generateTaste.logic.js';
import { DEFAULT_PROFILE_KEY, Profile } from '../src/models/profile.model.js';

const TASTE_MD_PATH = fileURLToPath(new URL('../taste-profile.md', import.meta.url));
const OPUS_MD_PATH = fileURLToPath(new URL('../taste-profile.opus.md', import.meta.url));
const logger = new Logger('gen-taste');

function readIfExists(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const providers: ILlmProvider[] = [];
  if (env.geminiApiKey) providers.push(new GeminiService(env.geminiApiKey, env.geminiModel, new Logger('gemini')));
  if (env.groqApiKey) providers.push(new GroqService(env.groqApiKey, env.groqModel, new Logger('groq')));
  if (!providers.length) throw new Error('No LLM configured — set GEMINI_API_KEY (and/or GROQ_API_KEY).');
  const llm = new LlmChain(providers, new Logger('llm'));

  await mongoose.connect(env.mongodbUri);
  try {
    // Prefer the Opus baseline as the exemplar so successive Gemini regens don't drift shorter.
    const exemplar = readIfExists(OPUS_MD_PATH) || readIfExists(TASTE_MD_PATH);
    const tasteRef: TasteProfileRef = {
      text: exemplar,
      version: await Profile.getTasteVersion(DEFAULT_PROFILE_KEY),
    };
    const gen = new GenerateTasteLogic(llm, tasteRef, TASTE_MD_PATH, logger);
    const ok = await gen.execute({ userKey: DEFAULT_PROFILE_KEY });
    if (!ok) throw new Error('regen failed (see logs above)');
    logger.info(`wrote ${TASTE_MD_PATH} (v${tasteRef.version})`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
