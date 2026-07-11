// Detects the single movie/show title on the current page, if one is clearly identifiable.
// Returns null on grids/browse/search (popup then falls back to manual + recommendations).
// Per-site heuristics — selectors are best-effort and easy to extend.

function clean(text) {
  return (text || '')
    .replace(/\s*[-|–]\s*(Netflix|Prime Video|JioCinema|Wikipedia|Disney\+ Hotstar).*$/i, '')
    // Wikipedia disambiguation suffix: "Parasite (2019 film)", "The Office (American TV series)".
    .replace(/\s*\([^)]*\b(?:film|series)\b[^)]*\)\s*$/i, '')
    .replace(/\s*\(\d{4}\)\s*$/, '') // trailing year
    .replace(/\s+/g, ' ')
    .trim();
}

// Prime Video puts the title in the document title: "Prime Video: Mr. Robot - Season 1".
function fromPrimeTitle(docTitle) {
  const t = clean(String(docTitle || '').replace(/^Prime Video:\s*/i, '').replace(/\s*[-–]\s*Season\s+\d+.*$/i, ''));
  return t && t.length > 1 ? t : null;
}

// Reject URL-id slugs (e.g. Prime's "0L52QDYY6OG738LB7ILP0VB7R4"): a single long token with a digit
// and no spaces is an id, not a title.
function looksLikeId(s) {
  return !/\s/.test(s) && /\d/.test(s) && s.length >= 8;
}

function firstText(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const t = clean(el && el.textContent);
    if (t) return t;
  }
  return null;
}

// `var` (not `const`) so an accidental re-injection into the same page can't throw a redeclare error.
var detectors = {
  'netflix.com': () =>
    // Only a watch/title page shows one title; the home grid has none.
    /\/(watch|title)\//.test(location.pathname)
      ? firstText(['[data-uia="video-title"]', '.title-title', 'h1'])
      : null,

  'primevideo.com': () => {
    if (!/\/detail\//.test(location.pathname)) return null;
    // Prime's title heading is unreliable/absent; it reliably lives in <title>:
    // "Prime Video: Mr. Robot - Season 1" → "Mr. Robot".
    return firstText(['h1[data-automation-id="title"]', 'h1']) || fromPrimeTitle(document.title);
  },

  'jiocinema.com': () => firstText(['h1']),
  // Hotstar opens titles in a modal over the grid, and its <h1> is site branding ("JioHotstar"),
  // so the URL slug (/in/shows/pritam-and-pedro/…) is the reliable source.
  'hotstar.com': () => slugTitle() || firstText(['h1']),

  'wikipedia.org': () => {
    // Article pages are reliable; not the search/portal.
    const t = firstText(['#firstHeading', 'h1']);
    return t && !/^(Main Page|Search)/i.test(t) ? t : null;
  },

  'google.com': () => {
    // Knowledge panel title (present when Google recognises a film/show).
    return firstText(['[data-attrid="title"]', 'div[role="heading"][aria-level="2"]']);
  },

  'youtube.com': () => {
    // Only a watch page has a single video; derive the film/show name from its title.
    if (!/\/watch/.test(location.pathname)) return null;
    const raw = firstText(['h1.ytd-watch-metadata', '#title h1', 'h1']) || document.title;
    return movieFromVideoTitle(raw);
  },
};

// A trailer/clip video title → the underlying film name, e.g.
// "Inception (2010) Official Trailer #1 - Christopher Nolan Movie HD" → "Inception",
// "PK Full Movie (2014) | Aamir Khan ..." → "PK". Cut at the first descriptor marker.
function movieFromVideoTitle(text) {
  let s = (text || '').replace(/\s*-\s*YouTube\s*$/i, '');
  const markers = [
    /\(\d{4}\)/, // (2010)
    /\b(official\s+)?(teaser\s+)?trailer\b/i,
    /\bteaser\b/i,
    /\bfull\s+(movie|video|film)\b/i,
    /\bclip\b/i,
    /\bfeaturette\b/i,
    /\bfirst\s+look\b/i,
    /\bmotion\s+poster\b/i,
    /\bvideo\s+song\b/i,
    /\|/,
    / - /,
  ];
  let cut = s.length;
  for (const m of markers) {
    const idx = s.search(m);
    if (idx > 0 && idx < cut) cut = idx;
  }
  return clean(s.slice(0, cut));
}

// Fallback: derive a title from the URL slug. Works when the title opens in a modal (Hotstar) or
// the DOM heuristic misses — detail URLs usually carry the title, e.g.
// hotstar.com/in/movies/kalki-2898-ad/1260124793 → "kalki 2898 ad".
function slugTitle() {
  const drop = /^(in|en|us|uk|watch|title|detail|video|movie|movies|show|shows|tv|series|sports|browse|home|wiki)$/i;
  const segs = location.pathname
    .split('/')
    .filter(Boolean)
    .filter((s) => !/^\d+$/.test(s)) // drop pure-id segments
    .filter((s) => !drop.test(s));
  const cand = segs[segs.length - 1]; // slug usually sits right before the numeric id
  if (!cand) return null;
  const t = clean(decodeURIComponent(cand).replace(/[-_]+/g, ' ').replace(/\s+\d{3,}$/, ''));
  return /[a-z]/i.test(t) && t.length > 1 && !looksLikeId(t) ? t : null;
}

// Generic fallback for sites we have no detector for: the Open Graph / Twitter-card title. Far more
// reliable than <h1> (often site branding, e.g. Letterboxd's "Letterboxd — Your life in film").
// Strips the site suffix after the first separator and clean() drops a trailing "(year)".
function metaTitle() {
  const el = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
  const raw = el && el.getAttribute('content');
  if (!raw) return null;
  const cut = raw.split(/\s+[|•⭐]\s*/)[0].split(/\s+-\s+/)[0];
  const t = clean(cut);
  return t && /[a-z]/i.test(t) && t.length > 1 ? t : null;
}

// A 4-digit year disambiguates same-name titles. Prefer the URL (…/the-batman-2022/…), then the
// og:title ("Inception (2010)"), then the page <title>.
function detectedYear() {
  const fromUrl = location.pathname.match(/\b(19|20)\d{2}\b/);
  if (fromUrl) return Number(fromUrl[0]);
  const meta = document.querySelector('meta[property="og:title"]');
  const fromMeta = meta && (meta.getAttribute('content') || '').match(/\b(19|20)\d{2}\b/);
  if (fromMeta) return Number(fromMeta[0]);
  const fromTitle = document.title.match(/\((19|20)\d{2}\)/);
  return fromTitle ? Number(fromTitle[0].slice(1, 5)) : undefined;
}

function detectTitle() {
  const host = location.hostname.replace(/^www\./, '');
  const key = Object.keys(detectors).find((d) => host.endsWith(d));
  // Detector for known sites; otherwise og:title → <h1>; slug as a last resort for any site.
  const title = (key ? detectors[key]() : metaTitle() || firstText(['h1'])) || slugTitle();
  return title ? { title, year: detectedYear() } : null;
}

// In the browser: wire the message listener. Guarded so this file can also be imported in Node
// (tests) where `chrome` doesn't exist, and so on-demand re-injection (popup → chrome.scripting on
// sites with no auto content script) doesn't stack duplicate listeners.
if (
  typeof chrome !== 'undefined' &&
  chrome.runtime &&
  chrome.runtime.onMessage &&
  !window.__cinematchWired
) {
  window.__cinematchWired = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'DETECT_TITLE') {
      sendResponse(detectTitle());
    }
    return true;
  });
}

// Export the pure helpers for unit tests (no-op in the browser, where `module` is undefined).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { movieFromVideoTitle, clean, fromPrimeTitle, looksLikeId };
}
