import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReview, normalizeVerdict, normalizeWatch, parseSubtitle } from './parse.js';

test('parseSubtitle extracts type and year', () => {
  assert.deepEqual(parseSubtitle('Movie • 2026 • 1 day ago'), { type: 'Movie', year: 2026 });
  assert.deepEqual(parseSubtitle('Show • 2019 • 4 days ago'), { type: 'Show', year: 2019 });
  assert.deepEqual(parseSubtitle('Anime • 2021'), { type: 'Anime', year: 2021 });
});

test('normalizeVerdict matches the 4 verdicts case-insensitively', () => {
  assert.equal(normalizeVerdict('Go For It'), 'Go For It');
  assert.equal(normalizeVerdict('perfection'), 'Perfection');
  assert.equal(normalizeVerdict('meh'), null);
});

test('normalizeReview builds a RatedMovie', () => {
  assert.deepEqual(
    normalizeReview({ title: 'The Furious', subtitle: 'Movie • 2026 • 1 day ago', verdict: 'Perfection' }),
    { title: 'The Furious', type: 'Movie', year: 2026, verdict: 'Perfection' },
  );
});

test('normalizeReview returns null for an unknown verdict or empty title', () => {
  assert.equal(normalizeReview({ title: 'X', subtitle: 'Movie • 2020', verdict: '???' }), null);
  assert.equal(normalizeReview({ title: '', subtitle: 'Movie • 2020', verdict: 'Skip' }), null);
});

test('normalizeWatch builds a WatchlistMovie with the collection id', () => {
  assert.deepEqual(normalizeWatch({ title: 'Iratta' }, '9MLFJ3ME'), {
    title: 'Iratta',
    type: 'Show',
    collectionId: '9MLFJ3ME',
  });
});
