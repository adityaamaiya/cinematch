// Pure, profile-independent scoring helpers — no class, no DB/HTTP. Shared by the logic layer + unit
// tests. (The statistical taste-affinity engine that used to live here was removed: taste is now the
// LLM's job. What remains is the objective verdict band + same-name language tie-breaking.)
import type { Verdict } from '../types/index.js';

const BANDS: readonly Verdict[] = ['Skip', 'Timepass', 'Go For It', 'Perfection'];

// The objective verdict — a TMDB rating dropped into one of four bands. Never moved by the profile.
export function verdictBand(rating: number): Verdict {
  if (rating < 4) return BANDS[0];
  if (rating < 6) return BANDS[1];
  if (rating < 7.5) return BANDS[2];
  return BANDS[3];
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

// Given the languages of the user's rated films, return the disambiguation priority (see tiers).
export function rankLanguages(languages: string[]): string[] {
  const counts: Record<string, number> = {};
  for (const lang of languages) if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
  return Object.entries(counts)
    .filter(([, n]) => n >= LANGUAGE_MIN_COUNT)
    .sort((a, b) => langTier(a[0]) - langTier(b[0]) || b[1] - a[1])
    .map(([lang]) => lang);
}
