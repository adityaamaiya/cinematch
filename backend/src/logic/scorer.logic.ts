// Verdict math + taste match. The verdict is the objective TMDB band and is NEVER moved by the
// profile. Taste match is a separate signal blended from genre + director + lead-actor affinity.
// Pure/sync logic class, reused by ScoreLogic and RecommendLogic.
import type {
  GenreAffinity,
  ILogic,
  PersonAffinity,
  TasteMatch,
  TasteMatchLevel,
  TmdbMovie,
  Verdict,
} from '../types/index.js';
import { mean } from '../lib/utils.js';

const BANDS: readonly Verdict[] = ['Skip', 'Timepass', 'Go For It', 'Perfection'];

// Blend weights over whichever signals are present (renormalised each time). Genre is broad;
// director is the strongest personal signal (a user's favourite auteur), actor a weaker one.
const SIGNAL_WEIGHT = { genre: 0.35, director: 0.45, actor: 0.2 } as const;

// Cutoffs on the blended score, calibrated against the owner's real 559-rating spread via
// scripts/calibrate-affinity.ts. The affinity scale is compressed (this user curates hard, so the
// mean weight is high and the max relative affinity is ~+0.76); a favourite auteur's films land at
// the ~top-20% mark (~0.19). STRONG sits there so flagship Nolan/Bong/Chazelle films read 🔥, while
// genuine off-taste (Timepass/Skip MCU filler) sits well below −MILD → mismatch. mismatch is score
// ≤ −MILD (symmetric). ~20% of the catalog reads strong here — fine for a heavy curator.
// ponytail: fixed cutoffs; per-user z-scoring on the affinity spread is the upgrade if forkers'
// distributions differ a lot.
const STRONG = 0.19;
const MILD = 0.1;

const MESSAGES: Record<TasteMatchLevel, string> = {
  strong: '🔥 Peak you — this is exactly your taste',
  mild: '✨ Looks like your kind of thing',
  mismatch: '🥴 Not your usual vibe',
};

export interface ScoreVerdictInput {
  movie: TmdbMovie;
  affinity: GenreAffinity;
  /** Title's director + lead actor (from TMDB credits), when known — enables the personal signals. */
  director?: string;
  leadActor?: string;
  /** Person-affinity maps from the profile; absent → genre-only, same as before this feature. */
  directorAffinity?: PersonAffinity;
  actorAffinity?: PersonAffinity;
}

export interface ScoredVerdict {
  verdict: Verdict;
  tasteMatch: TasteMatch | null;
}

// Pure/sync internally; execute() is async only to satisfy the shared ILogic contract.
export class Scorer implements ILogic<ScoreVerdictInput, ScoredVerdict> {
  async execute(input: ScoreVerdictInput): Promise<ScoredVerdict> {
    return {
      verdict: BANDS[this.bandFor(input.movie.rating)],
      tasteMatch: this.tasteMatch(input),
    };
  }

  private bandFor(rating: number): number {
    if (rating < 4) return 0;
    if (rating < 6) return 1;
    if (rating < 7.5) return 2;
    return 3;
  }

  // Blend genre (averaged over shared genres) + director + actor affinity, weighting each present
  // signal and renormalising. With no person maps this collapses to the old genre-only mean.
  private tasteMatch(input: ScoreVerdictInput): TasteMatch | null {
    const signals: { weight: number; value: number }[] = [];

    const genreVals = input.movie.genres
      .map((g) => input.affinity[g])
      .filter((v): v is number => typeof v === 'number');
    if (genreVals.length) signals.push({ weight: SIGNAL_WEIGHT.genre, value: mean(genreVals) });

    const dir = input.director ? input.directorAffinity?.[input.director] : undefined;
    if (typeof dir === 'number') signals.push({ weight: SIGNAL_WEIGHT.director, value: dir });

    const actor = input.leadActor ? input.actorAffinity?.[input.leadActor] : undefined;
    if (typeof actor === 'number') signals.push({ weight: SIGNAL_WEIGHT.actor, value: actor });

    if (signals.length === 0) return null;

    const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
    const score = signals.reduce((s, x) => s + x.weight * x.value, 0) / totalWeight;

    const level = this.levelFor(score);
    return level ? { level, message: MESSAGES[level] } : null;
  }

  private levelFor(score: number): TasteMatchLevel | null {
    if (score >= STRONG) return 'strong';
    if (score >= MILD) return 'mild';
    if (score <= -MILD) return 'mismatch';
    return null;
  }
}
