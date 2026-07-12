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

export interface LlmTasteInput {
  movie: TmdbMovie;
  director?: string;
  leadActor?: string;
}

const EMOJI: Record<TasteMatchLevel, string> = { strong: '🔥', mild: '✨', mismatch: '🥴' };
const LEVELS = new Set(['strong', 'mild', 'mismatch']);

export class LlmTaste implements ILogic<LlmTasteInput, TasteMatch | null> {
  constructor(
    private readonly gemini: IGeminiService,
    private readonly profile: string,
  ) {}

  async execute(input: LlmTasteInput): Promise<TasteMatch | null> {
    const raw = await this.gemini.generate(this.prompt(input), true);
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

  // Parse the model's JSON. Anything malformed / "none" → no taste line (null).
  private parse(raw: string): TasteMatch | null {
    let obj: { level?: string; why?: string };
    try {
      obj = JSON.parse(raw.trim().replace(/^```json\s*|\s*```$/g, ''));
    } catch {
      return null;
    }
    const level = obj.level;
    if (typeof level !== 'string' || !LEVELS.has(level)) return null;
    const why = typeof obj.why === 'string' && obj.why.trim() ? obj.why.trim() : null;
    const l = level as TasteMatchLevel;
    return { level: l, message: why ? `${EMOJI[l]} ${why}` : EMOJI[l] };
  }
}
