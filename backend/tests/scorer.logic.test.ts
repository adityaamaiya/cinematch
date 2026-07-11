import { describe, it, expect } from 'vitest';
import { Scorer } from '../src/logic/scorer.logic.js';
import type { GenreAffinity, TmdbMovie } from '../src/types/index.js';

function movie(rating: number, genres: string[] = []): TmdbMovie {
  return { tmdbId: 1, mediaType: 'movie', title: 'X', rating, genres, released: true };
}

const scorer = new Scorer();
const run = (m: TmdbMovie, affinity: GenreAffinity) => scorer.execute({ movie: m, affinity });

describe('Scorer verdict bands (always objective, never moved by profile)', () => {
  const cases: [number, string][] = [
    [0, 'Skip'],
    [3.9, 'Skip'],
    [4, 'Timepass'],
    [5.9, 'Timepass'],
    [6, 'Go For It'],
    [7.4, 'Go For It'],
    [7.5, 'Perfection'],
    [10, 'Perfection'],
  ];
  it.each(cases)('rating %s → %s', async (rating, verdict) => {
    expect((await run(movie(rating), {})).verdict).toBe(verdict);
  });

  it('a liked genre does NOT change the verdict', async () => {
    expect((await run(movie(6.5, ['Action']), { Action: 1.0 })).verdict).toBe('Go For It');
  });
});

describe('Scorer taste match (separate signal)', () => {
  it('null when there is no profile', async () => {
    expect((await run(movie(6.5, ['Action']), {})).tasteMatch).toBeNull();
  });

  it('null when the movie shares no genre with the profile', async () => {
    expect((await run(movie(6.5, ['Comedy']), { Action: 1.0 })).tasteMatch).toBeNull();
  });

  it('strong match for a strongly liked genre', async () => {
    const m = (await run(movie(6.5, ['Action']), { Action: 1.0 })).tasteMatch;
    expect(m?.level).toBe('strong');
    expect(m?.message.length).toBeGreaterThan(0);
  });

  it('mild match for a mildly liked genre', async () => {
    expect((await run(movie(6.5, ['Action']), { Action: 0.3 })).tasteMatch?.level).toBe('mild');
  });

  it('mismatch for a disliked genre', async () => {
    expect((await run(movie(6.5, ['Horror']), { Horror: -0.6 })).tasteMatch?.level).toBe('mismatch');
  });

  it('null (neutral) when affinity is near zero', async () => {
    expect((await run(movie(6.5, ['Action']), { Action: 0.05 })).tasteMatch).toBeNull();
  });

  it('averages affinity across the movie genres', async () => {
    // mean(+1.0, -0.2) = 0.4 → mild
    expect((await run(movie(6.5, ['Action', 'Drama']), { Action: 1.0, Drama: -0.2 })).tasteMatch?.level).toBe('mild');
  });
});
