// Verdict math + taste match. The verdict is the objective TMDB band and is NEVER moved by the
// profile. Taste match is a separate signal derived from genre affinity. Pure/sync logic class,
// reused by ScoreLogic and RecommendLogic.
import type { GenreAffinity, ILogic, TasteMatch, TasteMatchLevel, TmdbMovie, Verdict } from '../types/index.js';
import { mean } from '../lib/utils.js';

const BANDS: readonly Verdict[] = ['Skip', 'Timepass', 'Go For It', 'Perfection'];

const STRONG = 0.5;
// Below this (in abs) the signal is neutral → no message. Calibrated to a cinephile spread where
// most per-genre deltas sit in ±0.2 (rating almost everything highly compresses the range).
// ponytail: fixed cutoff; per-user z-scoring on the affinity spread is the upgrade if forkers'
// distributions differ a lot — pairs with the v2 director/actor-affinity work.
const MILD = 0.12;

const MESSAGES: Record<TasteMatchLevel, string> = {
  strong: '🔥 Peak you — this is exactly your taste',
  mild: '✨ Looks like your kind of thing',
  mismatch: '🥴 Not your usual vibe',
};

export interface ScoreVerdictInput {
  movie: TmdbMovie;
  affinity: GenreAffinity;
}

export interface ScoredVerdict {
  verdict: Verdict;
  tasteMatch: TasteMatch | null;
}

// Pure/sync internally; execute() is async only to satisfy the shared ILogic contract.
export class Scorer implements ILogic<ScoreVerdictInput, ScoredVerdict> {
  async execute({ movie, affinity }: ScoreVerdictInput): Promise<ScoredVerdict> {
    return {
      verdict: BANDS[this.bandFor(movie.rating)],
      tasteMatch: this.tasteMatch(movie.genres, affinity),
    };
  }

  private bandFor(rating: number): number {
    if (rating < 4) return 0;
    if (rating < 6) return 1;
    if (rating < 7.5) return 2;
    return 3;
  }

  // Average affinity over the genres the movie actually shares with the profile → a level.
  private tasteMatch(genres: string[], affinity: GenreAffinity): TasteMatch | null {
    const values = genres.map((g) => affinity[g]).filter((v): v is number => typeof v === 'number');
    if (values.length === 0) return null;

    const score = mean(values);
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
