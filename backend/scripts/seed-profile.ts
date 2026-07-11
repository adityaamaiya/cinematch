// Seed a taste profile without Moctale: POST a JSON file of ratings to /sync-profile.
// Usage: npm run seed [path/to/profile.json]   (defaults to profile.example.json)
import { readFile } from 'node:fs/promises';
import 'dotenv/config';

const file = process.argv[2] ?? 'profile.example.json';
const backendUrl = process.env.BACKEND_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const syncToken = process.env.SYNC_TOKEN;

async function main(): Promise<void> {
  if (!syncToken) throw new Error('SYNC_TOKEN missing in .env');

  const body = await readFile(file, 'utf8');
  const res = await fetch(`${backendUrl}/sync-profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${syncToken}` },
    body,
  });

  const json = (await res.json()) as { data?: unknown };
  if (!res.ok) throw new Error(`Sync failed (${res.status}): ${JSON.stringify(json)}`);
  console.log('Seeded profile:', json.data);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
