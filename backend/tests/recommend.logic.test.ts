import { describe, it, expect, vi, afterEach } from 'vitest';
import { LlmRecommend } from '../src/logic/llmRecommend.logic.js';
import { RecommendLogic } from '../src/logic/recommend.logic.js';
import { Profile } from '../src/models/profile.model.js';
import type { ITmdbService, RatedMovie, TmdbMovie } from '../src/types/index.js';
import type { MovieLookup } from '../src/logic/movieLookup.js';

const movie = (title: string, rating = 8): TmdbMovie => ({
  tmdbId: title.length,
  mediaType: 'movie',
  title,
  year: 2000,
  rating,
  genres: [],
  released: true,
});

const fakeTmdb = (): ITmdbService => ({
  searchTitle: vi.fn(async () => null),
  discover: vi.fn(async () => [movie('Discovered', 8.5)]),
  watchProviders: vi.fn(async () => null),
  trailerUrl: vi.fn(async () => undefined),
  credits: vi.fn(async () => ({})),
});

// MovieLookup stub: resolves any title EXCEPT ones in `unresolved` (simulating a TMDB miss).
const fakeLookup = (unresolved: string[] = []): MovieLookup =>
  ({
    execute: vi.fn(async ({ title }: { title: string }) =>
      unresolved.includes(title) ? null : movie(title),
    ),
  }) as unknown as MovieLookup;

const gemini = (titles: { title: string; year?: number }[]) => ({
  generate: vi.fn(async () => ({ text: JSON.stringify(titles), model: 'gemini-flash-latest', fallback: false })),
});

afterEach(() => vi.restoreAllMocks());

describe('LlmRecommend', () => {
  it('parses a JSON array of suggestions', async () => {
    const out = await new LlmRecommend(
      gemini([{ title: 'Heat', year: 1995 }, { title: 'Sicario' }]),
      'profile',
    ).execute({ limit: 5 });
    expect(out).toEqual([{ title: 'Heat', year: 1995 }, { title: 'Sicario', year: undefined }]);
  });

  it('unwraps an array from an object (Groq json_object mode wraps it under a key)', async () => {
    const svc = {
      generate: vi.fn(async () => ({
        text: '{"recommendations":[{"title":"Heat","year":1995}]}',
        model: 'llama-3.3-70b-versatile',
        fallback: true,
      })),
    };
    expect(await new LlmRecommend(svc, 'profile').execute({ limit: 5 })).toEqual([
      { title: 'Heat', year: 1995 },
    ]);
  });

  it('throws on malformed output so the caller falls back', async () => {
    const svc = { generate: vi.fn(async () => ({ text: 'not json', model: 'x', fallback: false })) };
    await expect(new LlmRecommend(svc, 'profile').execute({ limit: 5 })).rejects.toThrow(/malformed/);
  });
});

describe('RecommendLogic (LLM path)', () => {
  const rated: RatedMovie[] = [{ title: 'Seen It', type: 'Movie', year: 2001, verdict: 'Perfection' }];

  it('drops already-watched titles and TMDB-unresolved hallucinations', async () => {
    vi.spyOn(Profile, 'getRatedMovies').mockResolvedValue(rated);
    vi.spyOn(Profile, 'findLanguagePriority').mockResolvedValue([]);
    const llm = new LlmRecommend(
      gemini([
        { title: 'seen it' }, // already watched (case-insensitive) → dropped
        { title: 'Ghost Movie' }, // TMDB can't resolve → dropped
        { title: 'Good Pick' }, // survives
      ]),
      'profile',
    );
    const logic = new RecommendLogic(fakeTmdb(), fakeLookup(['Ghost Movie']), llm);
    const out = await logic.execute({ limit: 5, userKey: 'default' });
    expect(out.map((r) => r.title)).toEqual(['Good Pick']);
    expect(out[0].verdict).toBe('Perfection'); // rating 8 → Perfection band
  });

  it('falls back to discover when Gemini errors', async () => {
    vi.spyOn(Profile, 'getRatedMovies').mockResolvedValue([]);
    vi.spyOn(Profile, 'findLanguagePriority').mockResolvedValue([]);
    const llm = new LlmRecommend(
      { generate: vi.fn(async () => ({ text: 'broken', model: 'x', fallback: false })) },
      'profile',
    );
    const logic = new RecommendLogic(fakeTmdb(), fakeLookup(), llm);
    const out = await logic.execute({ limit: 5, mood: 'intense', userKey: 'default' });
    expect(out.map((r) => r.title)).toEqual(['Discovered']);
  });

  it('uses discover directly when no LLM is configured', async () => {
    const logic = new RecommendLogic(fakeTmdb(), fakeLookup());
    const out = await logic.execute({ limit: 5, mood: 'intense', userKey: 'default' });
    expect(out.map((r) => r.title)).toEqual(['Discovered']);
  });
});
