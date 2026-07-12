// Pure affinity + language builders — shared by SyncProfileLogic, the calibrate-affinity script,
// and the unit tests, so they live in their own module (no class, no DB/HTTP). SyncProfileLogic
// owns the orchestration; this file owns the math.
import type { Affinities, PersonAffinity, Verdict } from '../types/index.js';
import { mean, round2 } from './utils.js';

export const VERDICT_WEIGHT: Record<Verdict, number> = {
  Skip: 1,
  Timepass: 2,
  'Go For It': 3,
  Perfection: 4,
};

// Ignore genres with too few samples — one 5-star noir shouldn't make "Crime" a top genre.
const GENRE_MIN_SAMPLES = 3;
// Directors/actors need fewer samples to matter (a 2-film Nolan streak is a real signal), but
// still >1 so a single lucky pick doesn't dominate.
const PERSON_MIN_SAMPLES = 2;

/** One rated film reduced to the signals affinity is built from. */
export interface RatedSignals {
  weight: number;
  genres: string[];
  director?: string;
  leadActor?: string;
  language?: string;
}

// Languages the user watches enough to matter (≥ this many rated films). Used to break same-name
// title ties in TMDB search. Noise guard drops one-off languages.
const LANGUAGE_MIN_COUNT = 3;

// Same-name disambiguation order, in TIERS — two forces pull opposite ways. TMDB popularity already
// favours big English titles, so English must NOT lead (else a global English hit wins every tie,
// e.g. the English "Drishyam" over the Hindi one). But English must NOT be dead last either, or an
// obscure same-name foreign remake wins (the Japanese "Suits" beating the US mega-hit). So:
//   tier 0 — the owner's home (Indian) languages   → win ties first
//   tier 1 — English                                → the global default, middle
//   tier 2 — everything else (ko, ja, …)            → last
// Within a tier, ordered by how much the user actually watches.
// The home set is configurable per deployment via HOME_LANGUAGES (comma-separated ISO 639-1 codes);
// defaults to this repo owner's Indian-language set. A forker in another region sets their own.
// Read from process.env directly (not config/env) so this pure lib stays test-importable without
// the full env validation.
const HOME_LANGUAGES = new Set(
  (process.env.HOME_LANGUAGES ?? 'hi,ta,te,ml,kn,bn,mr,pa,gu,or,as,ur')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const langTier = (lang: string): number => (HOME_LANGUAGES.has(lang) ? 0 : lang === 'en' ? 1 : 2);

export function rankLanguages(films: RatedSignals[]): string[] {
  const counts: Record<string, number> = {};
  for (const f of films) if (f.language) counts[f.language] = (counts[f.language] ?? 0) + 1;
  return Object.entries(counts)
    .filter(([, n]) => n >= LANGUAGE_MIN_COUNT)
    .sort((a, b) => langTier(a[0]) - langTier(b[0]) || b[1] - a[1])
    .map(([lang]) => lang);
}

// Affinity = per-key mean verdict-weight minus the user's overall mean (relative preference, to
// cancel the cinephile bias of rating almost everything highly). Same math for genre + person maps.
// NB: a fixed baseline shift (e.g. toward the scale midpoint to "add absolute verdict level") only
// translates every score by a constant — it never changes rank, so it's equivalent to moving the
// scorer cutoffs and buys nothing. Ranking is set by the RELATIVE spread; tune cutoffs instead.
export function buildAffinities(films: RatedSignals[]): Affinities {
  const byGenre: Record<string, number[]> = {};
  const byDirector: Record<string, number[]> = {};
  const byActor: Record<string, number[]> = {};
  const allWeights: number[] = [];

  for (const f of films) {
    allWeights.push(f.weight);
    for (const g of f.genres) (byGenre[g] ??= []).push(f.weight);
    if (f.director) (byDirector[f.director] ??= []).push(f.weight);
    if (f.leadActor) (byActor[f.leadActor] ??= []).push(f.weight);
  }

  if (allWeights.length === 0) {
    return { genreAffinity: {}, directorAffinity: {}, actorAffinity: {} };
  }
  const baseline = mean(allWeights);

  const reduce = (m: Record<string, number[]>, minSamples: number): PersonAffinity => {
    const out: PersonAffinity = {};
    for (const [key, weights] of Object.entries(m)) {
      if (weights.length < minSamples) continue;
      out[key] = round2(mean(weights) - baseline);
    }
    return out;
  };

  return {
    genreAffinity: reduce(byGenre, GENRE_MIN_SAMPLES),
    directorAffinity: reduce(byDirector, PERSON_MIN_SAMPLES),
    actorAffinity: reduce(byActor, PERSON_MIN_SAMPLES),
  };
}
