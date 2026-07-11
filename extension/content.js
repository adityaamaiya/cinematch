// Detects the single movie/show title on the current page, if one is clearly identifiable.
// Returns null on grids/browse/search (popup then falls back to manual + recommendations).
// Per-site heuristics — selectors are best-effort and easy to extend.

function clean(text) {
  return (text || '')
    .replace(/\s*[-|–]\s*(Netflix|Prime Video|JioCinema|Wikipedia|Disney\+ Hotstar).*$/i, '')
    .replace(/\s*\(\d{4}\)\s*$/, '') // trailing year
    .replace(/\s+/g, ' ')
    .trim();
}

function firstText(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const t = clean(el && el.textContent);
    if (t) return t;
  }
  return null;
}

const detectors = {
  'netflix.com': () =>
    // Only a watch/title page shows one title; the home grid has none.
    /\/(watch|title)\//.test(location.pathname)
      ? firstText(['[data-uia="video-title"]', '.title-title', 'h1'])
      : null,

  'primevideo.com': () =>
    /\/detail\//.test(location.pathname) ? firstText(['h1[data-automation-id="title"]', 'h1']) : null,

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
  return /[a-z]/i.test(t) && t.length > 1 ? t : null;
}

// A 4-digit year disambiguates same-name titles. Prefer the URL (…/the-batman-2022/…);
// fall back to the page title (e.g. a YouTube trailer "… (2010) …").
function detectedYear() {
  const fromUrl = location.pathname.match(/\b(19|20)\d{2}\b/);
  if (fromUrl) return Number(fromUrl[0]);
  const fromTitle = document.title.match(/\((19|20)\d{2}\)/);
  return fromTitle ? Number(fromTitle[0].slice(1, 5)) : undefined;
}

function detectTitle() {
  const host = location.hostname.replace(/^www\./, '');
  const key = Object.keys(detectors).find((d) => host.endsWith(d));
  const title = (key ? detectors[key]() : firstText(['h1'])) || slugTitle();
  return title ? { title, year: detectedYear() } : null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'DETECT_TITLE') {
    sendResponse(detectTitle());
  }
  return true;
});
