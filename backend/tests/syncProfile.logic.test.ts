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

  it('tiers home languages first, then English, then others (each by count)', () => {
    const films = [
      ...Array(6).fill(0).map(() => film('en')),  // most-watched, but English sits in the middle tier
      ...Array(5).fill(0).map(() => film('hi')),  // home language
      ...Array(3).fill(0).map(() => film('ta')),  // home language
      ...Array(4).fill(0).map(() => film('ko')),  // other → last tier, even though more-watched than ta
      film('ja'), // only 1 → dropped
      film(undefined),
    ];
    // home (hi, ta by count) → en → other (ko). This is why the US "Suits" (en) beats a JA remake.
    expect(rankLanguages(films)).toEqual(['hi', 'ta', 'en', 'ko']);
  });

  it('keeps home-language order when there is no English', () => {
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
