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
}

export const env: Env = {
  port: Number(optional('PORT', '3000')),
  mongodbUri: required('MONGODB_URI'),
  tmdbApiKey: required('TMDB_API_KEY'),
  tmdbReadToken: required('TMDB_READ_ACCESS_TOKEN'),
  syncToken: required('SYNC_TOKEN'),
  omdbApiKey: optional('OMDB_API_KEY', ''),
};
