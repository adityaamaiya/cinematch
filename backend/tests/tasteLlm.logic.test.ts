import { describe, it, expect, vi } from 'vitest';
import { LlmTaste } from '../src/logic/tasteLlm.logic.js';
import type { IGeminiService, RatedMovie, TmdbMovie } from '../src/types/index.js';

const movie: TmdbMovie = {
  tmdbId: 1, mediaType: 'movie', title: 'Memories of Murder', year: 2003, rating: 8.1, genres: ['Crime', 'Drama'], released: true,
};
const rated: RatedMovie[] = [
  { title: 'Parasite', type: 'Movie', year: 2019, verdict: 'Perfection' },
  { title: 'The Avengers', type: 'Movie', year: 2012, verdict: 'Timepass' },
];
const fake = (text: string): IGeminiService => ({ generate: vi.fn(async () => text) });

describe('LlmTaste', () => {
  it('maps a strong verdict to a level + emoji message', async () => {
    const t = await new LlmTaste(fake('{"level":"strong","why":"you love Bong Joon-ho slow-burns"}')).execute({ ratedMovies: rated, movie });
    expect(t?.level).toBe('strong');
    expect(t?.message).toContain('🔥');
    expect(t?.message).toContain('Bong Joon-ho');
  });

  it('returns null for "none"', async () => {
    expect(await new LlmTaste(fake('{"level":"none","why":"unsure"}')).execute({ ratedMovies: rated, movie })).toBeNull();
  });

  it('returns null on malformed output', async () => {
    expect(await new LlmTaste(fake('not json at all')).execute({ ratedMovies: rated, movie })).toBeNull();
  });

  it('strips a ```json fence before parsing', async () => {
    const t = await new LlmTaste(fake('```json\n{"level":"mismatch","why":"too much action for you"}\n```')).execute({ ratedMovies: rated, movie });
    expect(t?.level).toBe('mismatch');
    expect(t?.message).toContain('🥴');
  });

  it('skips the model entirely when there are no ratings', async () => {
    const svc = fake('{"level":"strong"}');
    expect(await new LlmTaste(svc).execute({ ratedMovies: [], movie })).toBeNull();
    expect(svc.generate).not.toHaveBeenCalled();
  });

  it('includes the rated titles (grouped by verdict) in the prompt', async () => {
    const svc = fake('{"level":"strong","why":"x"}');
    await new LlmTaste(svc).execute({ ratedMovies: rated, movie });
    const prompt = (svc.generate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain('Perfection: Parasite (2019)');
    expect(prompt).toContain('Timepass: The Avengers (2012)');
    expect(prompt).toContain('Memories of Murder');
  });
});
