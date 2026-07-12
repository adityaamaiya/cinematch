// LLM taste mode: predict how THIS user would rate a film by reasoning over their rating history
// (tone, themes, director/cast patterns) — richer than the name-only statistical Scorer. Optional;
// ScoreLogic falls back to the Scorer when Gemini is unconfigured or errors.
import type {
  IGeminiService,
  ILogic,
  RatedMovie,
  TasteMatch,
  TasteMatchLevel,
  TmdbMovie,
} from '../types/index.js';

export interface LlmTasteInput {
  ratedMovies: RatedMovie[];
  movie: TmdbMovie;
  director?: string;
  leadActor?: string;
}

const EMOJI: Record<TasteMatchLevel, string> = { strong: '🔥', mild: '✨', mismatch: '🥴' };
const LEVELS = new Set(['strong', 'mild', 'mismatch']);
// Ratings are grouped by verdict in this order; the loved/disliked extremes carry the most signal.
const VERDICT_ORDER: RatedMovie['verdict'][] = ['Perfection', 'Go For It', 'Timepass', 'Skip'];

export class LlmTaste implements ILogic<LlmTasteInput, TasteMatch | null> {
  constructor(private readonly gemini: IGeminiService) {}

  async execute(input: LlmTasteInput): Promise<TasteMatch | null> {
    if (input.ratedMovies.length === 0) return null;
    const raw = await this.gemini.generate(this.prompt(input), true);
    return this.parse(raw);
  }

  private prompt({ ratedMovies, movie, director, leadActor }: LlmTasteInput): string {
    const byVerdict = VERDICT_ORDER.map((v) => {
      const titles = ratedMovies
        .filter((m) => m.verdict === v)
        .map((m) => (m.year ? `${m.title} (${m.year})` : m.title))
        .join(', ');
      return titles ? `${v}: ${titles}` : '';
    })
      .filter(Boolean)
      .join('\n');

    const meta = [
      `"${movie.title}"${movie.year ? ` (${movie.year})` : ''}`,
      movie.mediaType === 'tv' ? 'TV show' : 'movie',
      movie.genres.length ? `genres: ${movie.genres.join(', ')}` : '',
      director ? `director: ${director}` : '',
      leadActor ? `lead: ${leadActor}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    return `You predict whether one specific user will enjoy a film, from their rating history.
They rate on four levels: Perfection (loved), Go For It (liked), Timepass (meh), Skip (disliked).

Their ratings:
${byVerdict}

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
