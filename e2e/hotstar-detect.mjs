// Live Playwright check: real Hotstar movie pages need no login, so we can navigate one, inject the
// real extension/content.js, and confirm detectTitle() extracts a clean slug from the SPA URL.
// This is the extension side of the "avengers endgame" fix (backend match is covered by
// backend/tests/tmdb.service.test.ts + the prod /score smoke). Network-dependent, so it's opt-in
// (npm run test:hotstar) and NOT wired into the default `test` script — keeps CI deterministic.
//
// Run: npm run test:hotstar   (from e2e/)
import { chromium } from 'playwright';
import assert from 'node:assert';
import path from 'node:path';

// Hotstar opens the title in a modal over the grid and its <h1> is site branding, so content.js
// derives the name from the URL slug — the only source that stays fresh across SPA soft-nav.
const CASES = [
  { url: 'https://www.hotstar.com/in/movies/avengers-endgame/1260013556', expect: 'avengers endgame' },
];

const contentJs = path.resolve('..', 'extension', 'content.js');

async function main() {
  const browser = await chromium.launch();
  let failures = 0;
  try {
    for (const c of CASES) {
      const page = await browser.newPage();
      try {
        await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000); // let the SPA settle the slug into location
        await page.addScriptTag({ path: contentJs }); // defines detectTitle() in page scope
        const det = await page.evaluate(() => detectTitle());
        const got = det && det.title;
        if (got === c.expect) {
          console.log(`✓ ${c.url}\n    → "${got}"`);
        } else {
          failures++;
          console.error(`✗ ${c.url}\n    expected "${c.expect}", got ${JSON.stringify(det)}`);
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  assert.strictEqual(failures, 0, `${failures} Hotstar detection case(s) failed`);
  console.log('\nHotstar detection OK.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
