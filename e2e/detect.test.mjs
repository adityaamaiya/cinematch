// Unit test for the YouTube title → film-name extractor in extension/content.js.
// content.js is a classic script; it exports movieFromVideoTitle for tests (guarded, no-op in browser).
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { movieFromVideoTitle, clean } = require('../extension/content.js');

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
