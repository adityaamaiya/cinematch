import { describe, it, expect, vi } from 'vitest';
import { LlmTaste } from '../src/logic/tasteLlm.logic.js';
import type { IGeminiService, TmdbMovie } from '../src/types/index.js';

const movie: TmdbMovie = {
  tmdbId: 1, mediaType: 'movie', title: 'Memories of Murder', year: 2003, rating: 8.1, genres: ['Crime', 'Drama'], released: true,
};
const profile = 'Loves Korean crime thrillers and Bong Joon-ho slow-burns; bored by franchise filler.';
const fake = (text: string): IGeminiService => ({ generate: vi.fn(async () => text) });

describe('LlmTaste', () => {
  it('maps a strong verdict to a level + emoji message', async () => {
    const t = await new LlmTaste(fake('{"level":"strong","why":"you love Bong Joon-ho slow-burns"}'), profile).execute({ movie });
    expect(t?.level).toBe('strong');
    expect(t?.message).toContain('🔥');
    expect(t?.message).toContain('Bong Joon-ho');
  });

  it('returns null for "none"', async () => {
    expect(await new LlmTaste(fake('{"level":"none","why":"unsure"}'), profile).execute({ movie })).toBeNull();
  });

  it('returns null on malformed output', async () => {
    expect(await new LlmTaste(fake('not json at all'), profile).execute({ movie })).toBeNull();
  });

  it('strips a ```json fence before parsing', async () => {
    const t = await new LlmTaste(fake('```json\n{"level":"mismatch","why":"too much action for you"}\n```'), profile).execute({ movie });
    expect(t?.level).toBe('mismatch');
    expect(t?.message).toContain('🥴');
  });

  it('includes the taste profile and the title metadata in the prompt', async () => {
    const svc = fake('{"level":"strong","why":"x"}');
    await new LlmTaste(svc, profile).execute({ movie, director: 'Bong Joon-ho', leadActor: 'Song Kang-ho' });
    const prompt = (svc.generate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain(profile);
    expect(prompt).toContain('Memories of Murder');
    expect(prompt).toContain('director: Bong Joon-ho');
    expect(prompt).toContain('lead: Song Kang-ho');
  });
});
