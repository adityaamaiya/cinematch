// Browser-side scraping. Selectors are HEURISTIC (anchored on the 4 verdict texts, not brittle
// class names) since Cloudflare blocks inspecting the DOM without a real login. Run with --dump
// once after logging in to capture live HTML, then tighten these if needed.
import { createInterface } from 'node:readline/promises';
import { writeFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import type { RawReviewCard, RawWatchItem } from './parse.js';

const SCROLL_PAUSE_MS = 900;
const MAX_SCROLLS = 200;

async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(message);
  rl.close();
}

// Cloudflare's managed challenge renders a "Just a moment..." interstitial and only then
// redirects to the real page. `domcontentloaded` fires on the interstitial, so navigate and
// then WAIT for the challenge to clear (cf_clearance cookie from the manual login makes it quick).
async function gotoStable(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(() => !/just a moment|checking your browser/i.test(document.title), {
      timeout: 30_000,
    })
    .catch(() => {
      console.warn('⚠️  Cloudflare challenge did not clear in 30s — page may be incomplete.');
    });
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function isLoggedOut(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const hasPassword = !!document.querySelector('input[type="password"]');
    const url = location.href.toLowerCase();
    return hasPassword || url.includes('/login') || url.includes('/sign-in');
  });
}

// Navigate to the profile; if not logged in, pause for the human to log in (Cloudflare + creds).
export async function ensureLoggedIn(page: Page, profileUrl: string): Promise<void> {
  await gotoStable(page, profileUrl);
  if (await isLoggedOut(page)) {
    await waitForEnter(
      '\n👉 Log in to Moctale in the browser window (username/phone + password + Cloudflare),\n' +
        '   then come back here and press Enter to continue... ',
    );
    await gotoStable(page, profileUrl);
  }
}

// Scroll until the page height stops growing (infinite scroll fully loaded).
async function autoScroll(page: Page): Promise<void> {
  let last = 0;
  let stable = 0;
  for (let i = 0; i < MAX_SCROLLS; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(SCROLL_PAUSE_MS);
    const height = await page.evaluate(() => document.body.scrollHeight);
    if (height === last) {
      if (++stable >= 3) break;
    } else {
      stable = 0;
    }
    last = height;
  }
}

export async function dumpHtml(page: Page, file: string): Promise<void> {
  await writeFile(file, await page.content(), 'utf8');
}

export async function scrapeReviews(page: Page, profileUrl: string): Promise<RawReviewCard[]> {
  await gotoStable(page, profileUrl);
  await autoScroll(page);
  return page.evaluate(() => {
    const VERDICTS = ['Skip', 'Timepass', 'Go For It', 'Perfection'];
    const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

    const badges = Array.from(document.querySelectorAll('body *')).filter(
      (el) => el.childElementCount === 0 && VERDICTS.includes(norm(el.textContent)),
    );

    const cards: RawReviewCard[] = [];
    const seen = new Set<string>();
    for (const badge of badges) {
      let node: Element | null = badge;
      for (let i = 0; i < 6 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const heading = node.querySelector('h1,h2,h3,h4,a');
        const subtitleEl = Array.from(node.querySelectorAll('*')).find(
          (e) => e.childElementCount === 0 && /•/.test(e.textContent ?? ''),
        );
        if (heading && subtitleEl) {
          const title = norm(heading.textContent);
          const key = `${title}|${norm(badge.textContent)}`;
          if (title && !seen.has(key)) {
            seen.add(key);
            cards.push({ title, subtitle: norm(subtitleEl.textContent), verdict: norm(badge.textContent) });
          }
          break;
        }
      }
    }
    return cards;
  });
}

export async function scrapeWatchlist(page: Page, url: string): Promise<RawWatchItem[]> {
  await gotoStable(page, url);
  await autoScroll(page);
  return page.evaluate(() => {
    const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
    // Poster tiles: title usually in the image alt text.
    const items = Array.from(document.querySelectorAll('img'))
      .map((img) => ({ title: norm(img.getAttribute('alt')), subtitle: '' }))
      .filter((x) => x.title.length > 1);
    // Dedupe by title.
    const seen = new Set<string>();
    return items.filter((i) => (seen.has(i.title) ? false : seen.add(i.title)));
  });
}
