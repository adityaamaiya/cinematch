import { describe, it, expect } from 'vitest';
import { buildAffinities, rankLanguages, type RatedSignals } from '../src/logic/syncProfile.logic.js';

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

describe('rankLanguages', () => {
  const film = (language?: string): RatedSignals => ({ weight: 4, genres: [], language });

  it('orders by count but demotes English to the back (popularity already favors it)', () => {
    const films = [
      ...Array(6).fill(0).map(() => film('en')), // most-watched, but demoted
      ...Array(5).fill(0).map(() => film('hi')),
      ...Array(3).fill(0).map(() => film('ta')),
      film('ko'), // only 1 → dropped
      film(undefined), // no language → ignored
    ];
    expect(rankLanguages(films)).toEqual(['hi', 'ta', 'en']);
  });

  it('leaves the order alone when there is no English', () => {
    const films = [
      ...Array(5).fill(0).map(() => film('hi')),
      ...Array(3).fill(0).map(() => film('ta')),
    ];
    expect(rankLanguages(films)).toEqual(['hi', 'ta']);
  });

  it('returns [] when nothing clears the min count', () => {
    expect(rankLanguages([film('hi'), film('en')])).toEqual([]);
  });
});
