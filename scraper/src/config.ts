// Scraper env. No Moctale credentials — login is manual in the launched browser.
import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing env var: ${name}. See .env.example.`);
  return v;
}

export const config = {
  backendUrl: process.env.BACKEND_URL ?? 'http://localhost:3000',
  syncToken: required('SYNC_TOKEN'),
  profileUrl: required('MOCTALE_PROFILE_URL'),
  watchlistUrls: (process.env.MOCTALE_WATCHLIST_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Persistent browser profile — keeps the logged-in session so login is a one-time thing.
  sessionDir: process.env.SESSION_DIR ?? '.moctale-session',
};
