import { describe, it, expect, vi } from 'vitest';
import { LlmTaste } from '../src/logic/tasteLlm.logic.js';
import type { IGeminiService, TmdbMovie } from '../src/types/index.js';

const movie: TmdbMovie = {
  tmdbId: 1, mediaType: 'movie', title: 'Memories of Murder', year: 2003, rating: 8.1, genres: ['Crime', 'Drama'], released: true,
};
const profile = 'Loves Korean crime thrillers and Bong Joon-ho slow-burns; bored by franchise filler.';
const fake = (text: string): IGeminiService => ({ generate: vi.fn(async () => text) });

describe('LlmTaste', () => {
  it('maps a strong verdict to a level + emoji + score message', async () => {
    const t = await new LlmTaste(fake('{"level":"strong","score":92,"why":"you love Bong Joon-ho slow-burns"}'), profile).execute({ movie });
    expect(t?.level).toBe('strong');
    expect(t?.message).toBe('🔥 92% match — you love Bong Joon-ho slow-burns');
  });

  it('degrades gracefully when the score is missing or out of range', async () => {
    const t = await new LlmTaste(fake('{"level":"strong","score":250,"why":"x"}'), profile).execute({ movie });
    expect(t?.message).toBe('🔥 x');
  });

  it('returns null for "none"', async () => {
    expect(await new LlmTaste(fake('{"level":"none","why":"unsure"}'), profile).execute({ movie })).toBeNull();
  });

  it('throws on malformed output (so the caller falls back and does not cache it)', async () => {
    await expect(new LlmTaste(fake('not json at all'), profile).execute({ movie })).rejects.toThrow(/malformed/);
  });

  it('passes a response schema for constrained decoding', async () => {
    const svc = fake('{"level":"strong","why":"x"}');
    await new LlmTaste(svc, profile).execute({ movie });
    const schema = (svc.generate as ReturnType<typeof vi.fn>).mock.calls[0][2] as { required: string[] };
    expect(schema.required).toEqual(['level', 'score', 'why']);
  });

  it('strips a ```json fence before parsing', async () => {
    const t = await new LlmTaste(fake('```json\n{"level":"mismatch","score":20,"why":"too much action for you"}\n```'), profile).execute({ movie });
    expect(t?.level).toBe('mismatch');
    expect(t?.message).toBe('🥴 20% match — too much action for you');
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
