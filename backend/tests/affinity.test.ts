import { describe, it, expect } from 'vitest';
import { rankLanguages, verdictBand } from '../src/lib/affinity.js';

// Objective verdict band: rating → Skip/Timepass/Go For It/Perfection (never moved by the profile).
describe('verdictBand', () => {
  it('bands ratings at the boundaries', () => {
    expect(verdictBand(3.9)).toBe('Skip'); // <4
    expect(verdictBand(4)).toBe('Timepass'); // [4,6)
    expect(verdictBand(5.9)).toBe('Timepass');
    expect(verdictBand(6)).toBe('Go For It'); // [6,7.5)
    expect(verdictBand(7.4)).toBe('Go For It');
    expect(verdictBand(7.5)).toBe('Perfection'); // ≥7.5
    expect(verdictBand(9.1)).toBe('Perfection');
  });
});

// Same-name disambiguation order, in tiers: home languages → English → others, each by count.
describe('rankLanguages', () => {
  it('tiers home languages first, then English, then others (each by count)', () => {
    const languages = [
      ...Array(6).fill('en'), // most-watched, but English sits in the middle tier
      ...Array(5).fill('hi'), // home language
      ...Array(3).fill('ta'), // home language
      ...Array(4).fill('ko'), // other → last tier, even though more-watched than ta
      'ja', // only 1 → dropped
    ];
    // home (hi, ta by count) → en → other (ko). This is why the US "Suits" (en) beats a JA remake.
    expect(rankLanguages(languages)).toEqual(['hi', 'ta', 'en', 'ko']);
  });

  it('keeps home-language order when there is no English', () => {
    expect(rankLanguages([...Array(5).fill('hi'), ...Array(3).fill('ta')])).toEqual(['hi', 'ta']);
  });

  it('returns [] when nothing clears the min count', () => {
    expect(rankLanguages(['hi', 'en'])).toEqual([]);
  });
});
