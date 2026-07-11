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
    expect((await run(movie(6.5, ['Action']), { Action: 0.15 })).tasteMatch?.level).toBe('mild');
  });

  it('mismatch for a disliked genre', async () => {
    expect((await run(movie(6.5, ['Horror']), { Horror: -0.6 })).tasteMatch?.level).toBe('mismatch');
  });

  it('null (neutral) when affinity is near zero', async () => {
    expect((await run(movie(6.5, ['Action']), { Action: 0.05 })).tasteMatch).toBeNull();
  });

  it('averages affinity across the movie genres', async () => {
    // mean(+0.2, +0.1) = 0.15 → mild (between the two inputs). Single signal, no renorm change.
    expect((await run(movie(6.5, ['Action', 'Drama']), { Action: 0.2, Drama: 0.1 })).tasteMatch?.level).toBe('mild');
  });
});

describe('Scorer taste match (director + actor blend)', () => {
  // Nolan case: genres are neutral for this user, but the director is a strong favourite.
  it('a favourite director makes a neutral-genre film land strong', async () => {
    const m = await scorer.execute({
      movie: movie(8.4, ['Action', 'Science Fiction']),
      affinity: { Action: 0, 'Science Fiction': 0 }, // genre says nothing
      director: 'Christopher Nolan',
      leadActor: 'Leonardo DiCaprio',
      directorAffinity: { 'Christopher Nolan': 0.9 },
      actorAffinity: { 'Leonardo DiCaprio': 0.5 },
    });
    // blend = (0.35*0 + 0.45*0.9 + 0.20*0.5) / 1.0 = 0.505 → strong
    expect(m.tasteMatch?.level).toBe('strong');
  });

  it('person maps absent → genre-only result is unchanged', async () => {
    // Same movie, no director/actor signal: falls back to the genre mean (0) → neutral/null.
    const withPerson = await scorer.execute({
      movie: movie(8.4, ['Action']),
      affinity: { Action: 0.15 },
      director: 'Christopher Nolan',
      leadActor: 'Leonardo DiCaprio',
    });
    const genreOnly = await run(movie(8.4, ['Action']), { Action: 0.15 });
    // director/leadActor given but no affinity maps → they contribute nothing.
    expect(withPerson.tasteMatch?.level).toBe(genreOnly.tasteMatch?.level);
    expect(withPerson.tasteMatch?.level).toBe('mild');
  });

  it('a disliked director pulls a neutral-genre film to mismatch', async () => {
    const m = await scorer.execute({
      movie: movie(6.5, ['Drama']),
      affinity: { Drama: 0 },
      director: 'Uwe Boll',
      directorAffinity: { 'Uwe Boll': -0.8 },
    });
    // blend over {genre 0.35→0, director 0.45→-0.8} = -0.8*0.45/0.8 = -0.45 → mismatch
    expect(m.tasteMatch?.level).toBe('mismatch');
  });

  it('director not in the affinity map → that signal is skipped', async () => {
    const m = await scorer.execute({
      movie: movie(6.5, ['Action']),
      affinity: { Action: 0.15 },
      director: 'Some Unknown',
      directorAffinity: { 'Christopher Nolan': 0.9 },
    });
    expect(m.tasteMatch?.level).toBe('mild'); // only the genre signal counts
  });
});
