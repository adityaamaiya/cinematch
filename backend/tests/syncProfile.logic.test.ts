import { describe, it, expect } from 'vitest';
import { buildAffinities, type RatedSignals } from '../src/logic/syncProfile.logic.js';

// weight: Skip 1 … Perfection 4. buildAffinities = per-key mean weight − overall mean, with
// min-samples guards (genre ≥3, person ≥2).
describe('buildAffinities', () => {
  it('returns empty maps for no films', () => {
    expect(buildAffinities([])).toEqual({
      genreAffinity: {},
      directorAffinity: {},
      actorAffinity: {},
    });
  });

  it('learns a positive director affinity from a repeated favourite', () => {
    const films: RatedSignals[] = [
      { weight: 4, genres: ['Science Fiction'], director: 'Nolan', leadActor: 'A' },
      { weight: 4, genres: ['Science Fiction'], director: 'Nolan', leadActor: 'B' },
      { weight: 2, genres: ['Comedy'], director: 'X', leadActor: 'C' },
      { weight: 2, genres: ['Comedy'], director: 'Y', leadActor: 'D' },
      { weight: 2, genres: ['Comedy'], director: 'Z', leadActor: 'E' },
    ];
    // overall mean = 14/5 = 2.8
    const { genreAffinity, directorAffinity, actorAffinity } = buildAffinities(films);

    expect(directorAffinity.Nolan).toBeCloseTo(1.2); // mean 4 − 2.8, 2 samples ≥ 2 → kept
    expect(directorAffinity.X).toBeUndefined(); // only 1 sample < 2 → dropped
    expect(genreAffinity.Comedy).toBeCloseTo(-0.8); // 3 samples ≥ 3 → kept
    expect(genreAffinity['Science Fiction']).toBeUndefined(); // 2 samples < 3 → dropped
    expect(actorAffinity).toEqual({}); // every actor appears once
  });
});
