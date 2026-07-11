// Entry: open a real browser, ensure login, scrape reviews + watchlists, POST to backend.
// Flags: --dump  → after login, save the live HTML of the review + first watchlist page and exit
//                  (use this to tune selectors), no sync.
import { chromium } from 'playwright';
import { config } from './config.js';
import { ensureLoggedIn, scrapeReviews, scrapeWatchlist, dumpHtml } from './moctale.js';
import { normalizeReview, normalizeWatch } from './parse.js';
import { postProfile } from './api.js';

const dumpMode = process.argv.includes('--dump');

function collectionId(url: string): string {
  return url.split('/').filter(Boolean).pop() ?? 'unknown';
}

async function main(): Promise<void> {
  const ctx = await chromium.launchPersistentContext(config.sessionDir, {
    headless: false,
    viewport: null,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  try {
    await ensureLoggedIn(page, config.profileUrl);

    if (dumpMode) {
      await dumpHtml(page, 'reviews.dump.html');
      if (config.watchlistUrls[0]) {
        await page.goto(config.watchlistUrls[0], { waitUntil: 'domcontentloaded' });
        await dumpHtml(page, 'watchlist.dump.html');
      }
      console.log('📄 Dumped reviews.dump.html + watchlist.dump.html — inspect to tune selectors.');
      return;
    }

    const reviewCards = await scrapeReviews(page, config.profileUrl);
    const ratedMovies = reviewCards.map(normalizeReview).filter((m) => m !== null);
    console.log(`Found ${ratedMovies.length} rated titles.`);
    if (ratedMovies.length === 0) {
      console.warn('⚠️  0 reviews parsed — selectors may need tuning. Try `npm run scrape -- --dump`.');
    }

    const watchlist = [];
    for (const url of config.watchlistUrls) {
      const items = await scrapeWatchlist(page, url);
      const cid = collectionId(url);
      watchlist.push(...items.map((i) => normalizeWatch(i, cid)).filter((w) => w !== null));
    }
    console.log(`Found ${watchlist.length} watchlist items.`);

    await postProfile(config.backendUrl, config.syncToken, { ratedMovies, watchlist });
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
