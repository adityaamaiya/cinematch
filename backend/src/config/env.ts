// Typed env, validated once at import. Fails fast if a required var is missing.
import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

export interface Env {
  port: number;
  mongodbUri: string;
  tmdbApiKey: string;
  tmdbReadToken: string;
  syncToken: string;
  /** Optional — enables the awards + IMDb-rating line. Empty string = disabled. */
  omdbApiKey: string;
  /** Optional — enables the LLM taste line + recommendations. Empty string = disabled (no taste line). */
  geminiApiKey: string;
  /** Gemini model id(s) for the taste mode; comma-separated = fallback chain (own quota each). */
  geminiModel: string;
  /** Optional — Groq API key, the cross-provider fallback tried after every Gemini model 429s. */
  groqApiKey: string;
  /** Groq model id(s); comma-separated = fallback chain. Only used when GROQ_API_KEY is set. */
  groqModel: string;
  /** New in-app ratings that trigger an automatic taste-profile regen. Default 10. */
  tasteRegenEvery: number;
}

export const env: Env = {
  port: Number(optional('PORT', '3000')),
  mongodbUri: required('MONGODB_URI'),
  tmdbApiKey: required('TMDB_API_KEY'),
  tmdbReadToken: required('TMDB_READ_ACCESS_TOKEN'),
  syncToken: required('SYNC_TOKEN'),
  omdbApiKey: optional('OMDB_API_KEY', ''),
  geminiApiKey: optional('GEMINI_API_KEY', ''),
  geminiModel: optional('GEMINI_MODEL', 'gemini-flash-lite-latest,gemini-2.5-flash'),
  groqApiKey: optional('GROQ_API_KEY', ''),
  groqModel: optional('GROQ_MODEL', 'llama-3.3-70b-versatile'),
  tasteRegenEvery: Number(optional('TASTE_REGEN_EVERY', '10')),
};
