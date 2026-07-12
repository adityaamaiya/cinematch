// LLM taste mode: predict how THIS user would rate a film by reasoning over a precomputed taste
// profile (tone, themes, director/cast patterns) — richer than the name-only statistical Scorer.
// The profile is a compact prose summary of their rating history (backend/taste-profile.md),
// analysed offline so every /score prompt stays small. Optional; ScoreLogic falls back to the
// Scorer when Gemini is unconfigured or errors.
import type {
  IGeminiService,
  ILogic,
  TasteMatch,
  TasteMatchLevel,
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
    why: { type: 'STRING' },
  },
  required: ['level', 'why'],
} as const;

export class LlmTaste implements ILogic<LlmTasteInput, TasteMatch | null> {
  constructor(
    private readonly gemini: IGeminiService,
    private readonly profile: string,
  ) {}

  async execute(input: LlmTasteInput): Promise<TasteMatch | null> {
    const raw = await this.gemini.generate(this.prompt(input), true, RESPONSE_SCHEMA);
    return this.parse(raw);
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
${this.profile}

New title: ${meta}

Reason about tone, themes, structure, and director/cast patterns — not just genre. Then respond with
ONLY a JSON object, no prose:
{"level": "strong" | "mild" | "mismatch" | "none", "why": "<one short second-person sentence>"}
strong = they'll love it · mild = they'll probably like it · mismatch = not their taste · none = genuinely unsure.`;
  }

  // Parse the model's JSON. "none" → no taste line (null, cacheable). Malformed → throw: that's an
  // upstream fault, so ScoreLogic falls back to the statistical line and retries on the next request
  // instead of caching an empty answer for 6h.
  private parse(raw: string): TasteMatch | null {
    let obj: { level?: string; why?: string };
    try {
      obj = JSON.parse(raw.trim().replace(/^```json\s*|\s*```$/g, ''));
    } catch {
      throw AppError.upstream('Gemini returned malformed JSON');
    }
    const level = obj.level;
    if (typeof level !== 'string' || !LEVELS.has(level)) return null;
    const why = typeof obj.why === 'string' && obj.why.trim() ? obj.why.trim() : null;
    const l = level as TasteMatchLevel;
    return { level: l, message: why ? `${EMOJI[l]} ${why}` : EMOJI[l] };
  }
}
