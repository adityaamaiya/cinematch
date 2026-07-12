// E2E for the extension popup: load extension/popup.html in headless Chrome with the chrome.* APIs
// stubbed and the backend /score mocked, then assert the gauge + trailer + provider chips render.
// No extension install needed (that's the flaky part) — we drive popup.js directly.
// Run: npm run test:popup   (from scraper/)
import { chromium } from 'playwright';
import assert from 'node:assert';
import path from 'node:path';

const popupPath = 'file://' + path.resolve('..', 'extension', 'popup.html');

const SCORE = {
  success: true,
  data: {
    title: 'Inception',
    year: 2010,
    type: 'Movie',
    verdict: 'Perfection',
    tmdbRating: 8.4,
    voteCount: 36000,
    tasteMatch: { level: 'strong', message: '🔥 Peak you — this is exactly your taste' },
    posterUrl: 'https://img/inception.jpg',
    trailerUrl: 'https://www.youtube.com/watch?v=YoHD9XEInc0',
    director: 'Christopher Nolan',
    leadActor: 'Leonardo DiCaprio',
    awards: 'Won 4 Oscars.',
    imdbRating: '8.8',
    released: true,
    watch: {
      link: 'https://www.themoviedb.org/movie/27205/watch?locale=IN',
      flatrate: [{ name: 'Netflix', logoUrl: 'https://img/nf.jpg' }],
      rent: [],
      buy: [],
    },
  },
};

// Minimal chrome.* so popup.js runs: pretend the content script detected "Inception".
const CHROME_STUB = `
  const emptyStore = { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() };
  window.chrome = {
    runtime: {},
    storage: { local: emptyStore, session: emptyStore },
    tabs: {
      query: () => Promise.resolve([{ id: 1, url: 'https://example.com/watch' }]),
      sendMessage: (_id, _msg, cb) => cb({ title: 'Inception' }),
    },
  };
`;

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.addInitScript(CHROME_STUB);
  await page.route('**/score*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(SCORE) }),
  );

  await page.goto(popupPath);

  // Gauge + verdict from the detected title.
  await page.waitForSelector('#score-num', { timeout: 5000 });
  assert.strictEqual((await page.locator('.verdict').innerText()).trim(), 'Perfection', 'verdict renders');

  // Trailer button links to YouTube.
  const trailerHref = await page.locator('a.trailer').getAttribute('href');
  assert.ok(trailerHref?.includes('youtube.com/watch'), 'trailer button links to YouTube');

  // Where-to-watch provider chip.
  const providerText = await page.locator('.prov').first().innerText();
  assert.ok(providerText.includes('Netflix'), 'streaming provider chip renders');

  // Taste match line.
  assert.ok((await page.locator('.taste').innerText()).includes('Peak you'), 'taste match renders');

  // Poster, director/lead actor, awards, and the add-to-watchlist button.
  assert.ok(await page.locator('img.poster').count(), 'poster renders');
  const credits = await page.locator('.credits').innerText();
  assert.ok(credits.includes('Christopher Nolan') && credits.includes('Leonardo DiCaprio'), 'credits render');
  assert.ok((await page.locator('.awards').innerText()).includes('Oscars'), 'awards render');
  assert.ok(await page.locator('.wl-add').count(), 'add-to-watchlist button renders');

  // "Not this title?" escape hatch → switches to manual search, pre-filled with the wrong guess.
  assert.ok(await page.locator('#not-this').count(), 'not-this button renders');
  await page.locator('#not-this').click();
  await page.waitForSelector('#search', { timeout: 5000 });
  assert.strictEqual(await page.locator('#q').inputValue(), 'Inception', 'search is pre-filled with the guess');

  // Theme tokens swap the palette (dark vs light give different backgrounds).
  const bgFor = (t) =>
    page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      return getComputedStyle(document.body).backgroundColor;
    }, t);
  assert.notStrictEqual(await bgFor('dark'), await bgFor('light'), 'theme changes the background');

  // Regression: a released but unrated title (tmdbRating 0) shows "Too new", not a Skip verdict.
  await page.unroute('**/score*');
  await page.route('**/score*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { ...SCORE.data, verdict: 'Skip', tmdbRating: 0, voteCount: 0 } }),
    }),
  );
  await page.goto(popupPath);
  await page.waitForFunction(() => document.body.innerText.includes('Too new'), { timeout: 5000 });
  assert.ok(!(await page.locator('#score-num').count()), 'unrated title shows no score number/verdict');
  assert.ok(await page.locator('.taste').count(), 'unrated title still shows the taste line');

  // Regression: a content script that answers with NO title (e.g. Google with no panel) → manual
  // search, and must NOT re-inject content.js (double-inject throws "detectors already declared").
  const noTitle = await browser.newPage();
  await noTitle.addInitScript(`
    const s = { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() };
    window.__injected = false;
    window.chrome = {
      runtime: {},
      storage: { local: s, session: s },
      scripting: { executeScript: (_a, cb) => { window.__injected = true; cb && cb(); } },
      tabs: { query: () => Promise.resolve([{ id: 1, url: 'https://ex.com/p' }]), sendMessage: (_i, _m, cb) => cb({}) },
    };`);
  await noTitle.goto(popupPath);
  await noTitle.waitForSelector('#search', { timeout: 5000 });
  assert.strictEqual(await noTitle.evaluate(() => window.__injected), false, 'does not re-inject when a content script already answered');
  await noTitle.close();

  await browser.close();
  console.log('✓ popup e2e passed: gauge, verdict, trailer, provider, taste, poster, credits, awards, watchlist');
}

main().catch((err) => {
  console.error('✗ popup e2e failed:', err.message);
  process.exit(1);
});
