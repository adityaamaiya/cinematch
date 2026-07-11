// Unit test for the YouTube title → film-name extractor in extension/content.js.
// content.js is a classic script; it exports movieFromVideoTitle for tests (guarded, no-op in browser).
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { movieFromVideoTitle, clean, fromPrimeTitle, looksLikeId } = require('../extension/content.js');

test('movieFromVideoTitle strips trailer/clip cruft to the film name', () => {
  const cases = [
    ['Inception (2010) Official Trailer #1 - Christopher Nolan Movie HD', 'Inception'],
    ['PK Full Movie (2014) | Aamir Khan | Anushka Sharma', 'PK'],
    ['The Batman - Official Trailer', 'The Batman'],
    ['Interstellar Official Teaser Trailer', 'Interstellar'],
    ['Oppenheimer (2023) | Final Trailer', 'Oppenheimer'],
    ['Dune: Part Two | Official Trailer 3', 'Dune: Part Two'],
    ['Spirited Away - Official Trailer - YouTube', 'Spirited Away'],
  ];
  for (const [input, want] of cases) {
    assert.strictEqual(movieFromVideoTitle(input), want, `"${input}"`);
  }
});

test('clean strips Wikipedia disambiguation + year suffixes', () => {
  const cases = [
    ['Parasite (2019 film)', 'Parasite'],
    ['Interstellar (film)', 'Interstellar'],
    ['The Office (American TV series)', 'The Office'],
    ['Dune (2021 film)', 'Dune'],
    ['Inception (2010)', 'Inception'],
    ['Interstellar', 'Interstellar'], // untouched
  ];
  for (const [input, want] of cases) {
    assert.strictEqual(clean(input), want, `"${input}"`);
  }
});

test('fromPrimeTitle pulls the title out of the Prime <title>', () => {
  assert.strictEqual(fromPrimeTitle('Prime Video: Mr. Robot - Season 1'), 'Mr. Robot');
  assert.strictEqual(fromPrimeTitle('Prime Video: The Boys - Season 4'), 'The Boys');
  assert.strictEqual(fromPrimeTitle('Prime Video: Oppenheimer'), 'Oppenheimer');
});

test('looksLikeId flags URL ids, not real titles', () => {
  assert.ok(looksLikeId('0L52QDYY6OG738LB7ILP0VB7R4'));
  assert.ok(!looksLikeId('the batman 2022'));
  assert.ok(!looksLikeId('interstellar'));
  assert.ok(!looksLikeId('1917')); // short → not treated as an id here
});
