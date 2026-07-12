// LLM recommendations: ask Gemini for titles THIS user would rate Perfection/Go For It, reasoning
// over the same taste profile the taste line uses (backend/taste-profile.md). Mirrors LlmTaste.
// RecommendLogic resolves each suggestion on TMDB (dropping hallucinations) and filters out films
// the user has already watched. Optional; RecommendLogic falls back to genre-discover with no key.
import type { ILlm, ILogic, Mood } from '../types/index.js';
import { AppError } from '../lib/errors.js';

export interface LlmRecommendInput {
  mood?: Mood;
  genre?: string;
  /** How many titles to return; we over-request to survive dedup + TMDB-unresolved drops. */
  limit: number;
}

export interface LlmSuggestion {
  title: string;
  year?: number;
}

// Constrained decoding (Gemini responseSchema) — the thinking model occasionally emits broken JSON
// without it, which would read as "no recommendations" and fall back to discover.
const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { title: { type: 'STRING' }, year: { type: 'INTEGER' } },
    required: ['title'],
  },
} as const;

export class LlmRecommend implements ILogic<LlmRecommendInput, LlmSuggestion[]> {
  constructor(
    private readonly llm: ILlm,
    private readonly profile: string,
  ) {}

  async execute(input: LlmRecommendInput): Promise<LlmSuggestion[]> {
    const { text } = await this.llm.generate(this.prompt(input), true, RESPONSE_SCHEMA);
    return this.parse(text);
  }

  private prompt({ mood, genre, limit }: LlmRecommendInput): string {
    // Over-request: the caller drops already-watched titles and TMDB-unresolved hallucinations.
    const want = limit + 10;
    const filter = [
      genre ? `in the "${genre}" genre` : '',
      mood ? `that fit a "${mood}" mood` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return `You recommend films/shows to one specific viewer, from their taste profile.

Their taste profile:
${this.profile}

Suggest ${want} titles${filter ? ` ${filter}` : ''} that this viewer would most likely rate "Perfection" or "Go For It" — the best matches for their taste. Prefer well-known, findable titles (avoid extremely obscure ones). Vary directors and eras; do not pad with sequels of one franchise.

Respond with ONLY a JSON array, no prose:
[{"title": "<title>", "year": <release year>}]`;
  }

  // Parse the model's JSON array. Malformed → throw (upstream fault) so RecommendLogic falls back to
  // discover instead of returning nothing.
  private parse(raw: string): LlmSuggestion[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim().replace(/^```json\s*|\s*```$/g, ''));
    } catch {
      throw AppError.upstream('LLM returned malformed JSON');
    }
    // Gemini (responseSchema) returns a bare array; Groq's json_object mode can only return an
    // OBJECT, so it wraps the array under some key — grab the first array-valued property.
    let arr = parsed;
    if (!Array.isArray(arr) && arr && typeof arr === 'object') {
      arr = Object.values(arr as Record<string, unknown>).find(Array.isArray) ?? arr;
    }
    if (!Array.isArray(arr)) throw AppError.upstream('LLM did not return an array');
    return arr
      .map((o): LlmSuggestion | null => {
        const title = typeof o?.title === 'string' ? o.title.trim() : '';
        if (!title) return null;
        const year = typeof o?.year === 'number' && o.year > 1800 ? Math.round(o.year) : undefined;
        return { title, year };
      })
      .filter((s): s is LlmSuggestion => s !== null);
  }
}
