// POST the scraped profile to the backend.
import type { RatedMovie, WatchlistMovie } from '../../backend/src/types/index.js';

export interface ProfilePayload {
  ratedMovies: RatedMovie[];
  watchlist: WatchlistMovie[];
}

export async function postProfile(
  backendUrl: string,
  syncToken: string,
  payload: ProfilePayload,
): Promise<void> {
  const res = await fetch(`${backendUrl}/sync-profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${syncToken}` },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { data?: unknown; error?: unknown };
  if (!res.ok) throw new Error(`Sync failed (${res.status}): ${JSON.stringify(json.error)}`);
  console.log('✅ Synced profile:', json.data);
}
