// One-off: compute genre+director+actor affinities from a profile JSON via TMDB, then print the
// blended-taste-score distribution under a few signal-weight configs so the STRONG/MILD cutoffs in
// scorer.logic.ts can be tuned. Resolved TMDB data is cached to disk so re-runs are instant.
// Usage: npx tsx scripts/calibrate-affinity.ts [profile.local.json]   (needs TMDB_READ_ACCESS_TOKEN)
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'dotenv/config';
import { TmdbService } from '../src/services/tmdb.service.js';
import { Logger } from '../src/lib/logger.js';
import { buildAffinities, type RatedSignals } from '../src/logic/syncProfile.logic.js';
import type { RatedMovie, Verdict } from '../src/types/index.js';

const VERDICT_WEIGHT: Record<Verdict, number> = { Skip: 1, Timepass: 2, 'Go For It': 3, Perfection: 4 };

interface Resolved {
  title: string;
  verdict: Verdict;
  genres: string[];
  director?: string;
  leadActor?: string;
}

const CACHE = join(tmpdir(), 'cinematch-calibrate-resolved.json');
const file = process.argv[2] ?? 'profile.local.json';

async function resolveAll(): Promise<Resolved[]> {
  try {
    const cached = JSON.parse(await readFile(CACHE, 'utf8')) as Resolved[];
    console.log(`Loaded ${cached.length} resolved films from cache.`);
    return cached;
  } catch {
    /* no cache — resolve via TMDB */
  }
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (!token) throw new Error('TMDB_READ_ACCESS_TOKEN missing');
  const tmdb = new TmdbService('https://api.themoviedb.org/3', token, new Logger('calib'));
  const { ratedMovies } = JSON.parse(await readFile(file, 'utf8')) as { ratedMovies: RatedMovie[] };
  console.log(`Resolving ${ratedMovies.length} films via TMDB (sequential)…`);

  const out: Resolved[] = [];
  let done = 0;
  for (const rm of ratedMovies) {
    const movie = await tmdb.searchTitle(rm.title, rm.year).catch(() => null);
    if (++done % 50 === 0) console.log(`  …${done}/${ratedMovies.length}`);
    if (!movie) continue;
    const credits = await tmdb.credits(movie.tmdbId, movie.mediaType).catch(() => ({}) as never);
    out.push({
      title: rm.title,
      verdict: rm.verdict,
      genres: movie.genres,
      director: credits.director,
      leadActor: credits.leadActor,
    });
  }
  await writeFile(CACHE, JSON.stringify(out));
  return out;
}

interface Weights {
  genre: number;
  director: number;
  actor: number;
}

function blend(r: Resolved, aff: ReturnType<typeof buildAffinities>, w: Weights): number | null {
  const parts: { w: number; v: number }[] = [];
  const gv = r.genres.map((g) => aff.genreAffinity[g]).filter((v): v is number => typeof v === 'number');
  if (gv.length) parts.push({ w: w.genre, v: gv.reduce((a, b) => a + b, 0) / gv.length });
  const d = r.director ? aff.directorAffinity[r.director] : undefined;
  if (typeof d === 'number') parts.push({ w: w.director, v: d });
  const a = r.leadActor ? aff.actorAffinity[r.leadActor] : undefined;
  if (typeof a === 'number') parts.push({ w: w.actor, v: a });
  if (!parts.length) return null;
  const tw = parts.reduce((s, x) => s + x.w, 0);
  return parts.reduce((s, x) => s + x.w * x.v, 0) / tw;
}

async function main(): Promise<void> {
  const resolved = await resolveAll();
  const sigs: RatedSignals[] = resolved.map((r) => ({
    weight: VERDICT_WEIGHT[r.verdict],
    genres: r.genres,
    director: r.director,
    leadActor: r.leadActor,
  }));

  // β fixed at 1 (pure relative — baseline shift is a no-op translation). Sweep signal weights:
  // does leaning on director lift Nolan's flagship films ABOVE the pack (real separation)?
  const configs: [string, Weights][] = [
    ['current  g.35 d.45 a.20', { genre: 0.35, director: 0.45, actor: 0.2 }],
    ['dir-lean g.25 d.55 a.20', { genre: 0.25, director: 0.55, actor: 0.2 }],
    ['dir-dom  g.20 d.65 a.15', { genre: 0.2, director: 0.65, actor: 0.15 }],
    ['dir-max  g.15 d.70 a.15', { genre: 0.15, director: 0.7, actor: 0.15 }],
  ];
  const aff = buildAffinities(sigs);
  const NAMED = ['Inception', 'The Prestige', 'Interstellar'];

  for (const [label, w] of configs) {
    const scored = resolved
      .map((r) => ({ r, score: blend(r, aff, w) }))
      .filter((x): x is { r: Resolved; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score);

    const n = scored.length;
    const rankScore = (pct: number) => scored[Math.floor((pct / 100) * n)].score; // score at percentile cutoff
    const nolan = scored.filter((s) => s.r.director === 'Christopher Nolan');
    const namedPct = NAMED.map((t) => {
      const idx = scored.findIndex((s) => s.r.title === t);
      return idx < 0 ? `${t}:?` : `${t}:${Math.round((idx / n) * 100)}pct(${scored[idx].score.toFixed(2)})`;
    });

    console.log(`\n===== ${label} =====`);
    console.log(`  cutoff@top10%=${rankScore(10).toFixed(2)}  top15%=${rankScore(15).toFixed(2)}  top20%=${rankScore(20).toFixed(2)}`);
    console.log(`  Nolan scores: ${nolan.map((x) => x.score.toFixed(2)).join(', ')}`);
    console.log(`  Named films (percentile, higher=better): ${namedPct.join('  ')}`);
    console.log(`  Bottom 5 (off-taste): ${scored.slice(-5).map((s) => `${s.r.title}(${s.score.toFixed(2)})`).join(', ')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
