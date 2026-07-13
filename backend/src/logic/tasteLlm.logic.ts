// LLM taste mode: predict how THIS user would rate a film by reasoning over a precomputed taste
// profile (tone, themes, director/cast patterns). The profile is a compact prose summary of their
// rating history (backend/taste-profile.md), analysed offline so every /score prompt stays small.
// Optional; ScoreLogic shows no taste line when the LLM is unconfigured or errors.
import type {
  ILlm,
  ILogic,
  TasteMatch,
  TasteMatchLevel,
  TasteProfileRef,
  TmdbMovie,
} from '../types/index.js';
import { AppError } from '../lib/errors.js';

export interface LlmTasteInput {
  movie: TmdbMovie;
  director?: string;
  leadActor?: string;
}

const EMOJI: Record<TasteMatchLevel, string> = { strong: '🔥', mild: '✨', mismatch: '🥴' };
const LEVELS = new Set(['strong', 'mild', 'mismatch']);
// Gemini responseSchema (constrained decoding) — the thinking model occasionally emits broken JSON
// without it (stray quotes), which used to read as "no taste line" and get cached for 6h.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    level: { type: 'STRING', enum: ['strong', 'mild', 'mismatch', 'none'] },
    score: { type: 'INTEGER' },
    why: { type: 'STRING' },
  },
  required: ['level', 'score', 'why'],
} as const;

export class LlmTaste implements ILogic<LlmTasteInput, TasteMatch | null> {
  constructor(
    private readonly llm: ILlm,
    // Mutable ref (not a plain string) so a regen updates the profile the live process reasons over,
    // no restart. Empty text → no taste line (a blank profile would only mislead the model).
    private readonly profileRef: TasteProfileRef,
  ) {}

  async execute(input: LlmTasteInput): Promise<TasteMatch | null> {
    if (!this.profileRef.text.trim()) return null;
    const { text, model, fallback } = await this.llm.generate(this.prompt(input), true, RESPONSE_SCHEMA);
    const taste = this.parse(text);
    // Surface the model only when a fallback answered (primary exhausted) — the popup shows it small.
    if (taste && fallback) taste.via = model;
    return taste;
  }

  private prompt({ movie, director, leadActor }: LlmTasteInput): string {
    const meta = [
      `"${movie.title}"${movie.year ? ` (${movie.year})` : ''}`,
      movie.mediaType === 'tv' ? 'TV show' : 'movie',
      movie.genres.length ? `genres: ${movie.genres.join(', ')}` : '',
      director ? `director: ${director}` : '',
      leadActor ? `lead: ${leadActor}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    return `You predict whether one specific viewer will enjoy a title, from their taste profile.

Their taste profile:
${this.profileRef.text}

New title: ${meta}

Reason about tone, themes, structure, and director/cast patterns — not just genre. Then respond with
ONLY a JSON object, no prose:
{"level": "strong" | "mild" | "mismatch" | "none", "score": <0-100 how well it matches their taste>, "why": "<one short second-person sentence>"}
strong = they'll love it (score ≥75) · mild = they'll probably like it (score 50-74) · mismatch = not their taste (score <50) · none = genuinely unsure.`;
  }

  // Parse the model's JSON. "none" → no taste line (null, cacheable). Malformed → throw: that's an
  // upstream fault, so ScoreLogic drops the taste line and retries on the next request instead of
  // caching an empty answer for 6h.
  private parse(raw: string): TasteMatch | null {
    let obj: { level?: string; score?: number; why?: string };
    try {
      obj = JSON.parse(raw.trim().replace(/^```json\s*|\s*```$/g, ''));
    } catch {
      throw AppError.upstream('Gemini returned malformed JSON');
    }
    const level = obj.level;
    if (typeof level !== 'string' || !LEVELS.has(level)) return null;
    const why = typeof obj.why === 'string' && obj.why.trim() ? obj.why.trim() : null;
    const score =
      typeof obj.score === 'number' && obj.score >= 0 && obj.score <= 100
        ? Math.round(obj.score)
        : null;
    const l = level as TasteMatchLevel;
    // "🔥 92% match — <why>"; degrade gracefully when score or why is missing. The popup renders
    // score + why as its own card, but keep the composed message for compact/fallback use.
    const parts = [score !== null ? `${score}% match` : '', why ?? ''].filter(Boolean).join(' — ');
    return { level: l, score, why, message: parts ? `${EMOJI[l]} ${parts}` : EMOJI[l] };
  }
}
