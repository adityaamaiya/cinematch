// Convert a raw Moctale review dump (the JSON from the browser-console fetch of
// /api/profile/<user>/review) into the /sync-profile body shape, written to profile.example.json.
//
// Usage: npx tsx scripts/moctale-to-profile.ts <raw-moctale.json> [out.json]
import { readFile, writeFile } from 'node:fs/promises';
import type { RatedMovie, Verdict } from '../src/types/index.js';

interface MoctaleReview {
  name: string;
  slug?: string;
  year?: number;
  is_show?: boolean;
  season_name?: string | null;
  verdict: string;
}

const WEIGHT: Record<Verdict, number> = { Skip: 1, Timepass: 2, 'Go For It': 3, Perfection: 4 };

// Moctale API verdict enum → our 4-point scale.
const VERDICT_MAP: Record<string, Verdict> = {
  NEGATIVE: 'Skip',
  NEUTRAL: 'Timepass',
  POSITIVE: 'Go For It',
  PERFECT: 'Perfection',
};

const normKey = (v: string) => v.trim().toUpperCase().replace(/[\s-]+/g, '_');

async function main(): Promise<void> {
  const inPath = process.argv[2];
  const outPath = process.argv[3] ?? 'profile.example.json';
  if (!inPath) throw new Error('usage: tsx scripts/moctale-to-profile.ts <raw-moctale.json> [out.json]');

  const raw = JSON.parse(await readFile(inPath, 'utf8')) as MoctaleReview[];
  const counts: Record<string, number> = {};
  const unknown = new Set<string>();

  // A show is rated both overall (season_name null) and per-season; the same title repeats.
  // Dedup by slug (title identity), preferring the overall rating, else the highest season.
  // Keeps one rating per title so a multi-season show doesn't skew the genre affinity.
  const best = new Map<string, RatedMovie & { isOverall: boolean }>();
  for (const r of raw) {
    const key = normKey(r.verdict ?? '');
    counts[key] = (counts[key] ?? 0) + 1;
    const verdict = VERDICT_MAP[key];
    if (!verdict || !r.name) {
      if (!verdict) unknown.add(r.verdict);
      continue;
    }
    const id = r.slug ?? `${r.name}|${r.year ?? ''}`;
    const isOverall = r.season_name == null;
    const candidate = { title: r.name.trim(), type: r.is_show ? 'Show' : 'Movie', year: r.year, verdict, isOverall } as const;
    const cur = best.get(id);
    // Prefer an overall rating; between same-tier entries, prefer the higher verdict.
    if (
      !cur ||
      (candidate.isOverall && !cur.isOverall) ||
      (candidate.isOverall === cur.isOverall && WEIGHT[verdict] > WEIGHT[cur.verdict])
    ) {
      best.set(id, { ...candidate });
    }
  }
  const ratedMovies: RatedMovie[] = [...best.values()].map(({ isOverall: _o, ...m }) => m);

  console.log('verdict histogram (raw rows):', counts);
  if (unknown.size) console.warn('⚠️  UNMAPPED verdicts (add to VERDICT_MAP):', [...unknown]);
  console.log(`mapped ${ratedMovies.length} unique titles from ${raw.length} rows`);

  await writeFile(outPath, JSON.stringify({ ratedMovies, watchlist: [] }, null, 2), 'utf8');
  console.log(`wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
