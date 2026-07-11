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
};

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

function detectTitle() {
  const host = location.hostname.replace(/^www\./, '');
  const key = Object.keys(detectors).find((d) => host.endsWith(d));
  const title = (key ? detectors[key]() : firstText(['h1'])) || slugTitle();
  return title ? { title } : null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'DETECT_TITLE') {
    sendResponse(detectTitle());
  }
  return true;
});
