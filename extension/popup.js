// Popup controller: detect the page's title → score it (gauge), else offer manual search +
// mood-based recommendations. Talks to the backend directly (host_permissions covers it).

const DEFAULT_BACKEND = 'https://cinematch.adityadevhub.in';
const MOODS = ['chill', 'intense', 'feelgood', 'mindbender', 'classic'];
const VERDICT_VAR = {
  Skip: '--skip',
  Timepass: '--timepass',
  'Go For It': '--goforit',
  Perfection: '--perfection',
};

const view = document.getElementById('view');

async function backendUrl() {
  const { backendUrl } = await chrome.storage.local.get('backendUrl');
  return backendUrl || DEFAULT_BACKEND;
}

// --- Theme: auto (prefers-color-scheme) by default, with a persistent toggle ---
function effectiveTheme() {
  return (
    document.documentElement.dataset.theme ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );
}
function setThemeIcon() {
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = effectiveTheme() === 'light' ? '☀️' : '🌙';
}
async function initTheme() {
  const { theme } = await chrome.storage.local.get('theme');
  if (theme) document.documentElement.dataset.theme = theme; // else stays auto
  setThemeIcon();
  document.getElementById('theme-toggle')?.addEventListener('click', async () => {
    const next = effectiveTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    setThemeIcon();
    await chrome.storage.local.set({ theme: next });
  });
}
initTheme();

function color(verdict) {
  return `var(${VERDICT_VAR[verdict] || '--muted'})`;
}

// Semicircle gauge filled to rating/10, coloured by verdict.
function gaugeSvg(rating, verdict) {
  const r = 110;
  const len = Math.PI * r; // semicircle arc length
  const frac = Math.max(0, Math.min(1, rating / 10));
  const path = `M 20 130 A ${r} ${r} 0 0 1 240 130`;
  return `
    <svg id="gauge" width="260" height="150" viewBox="0 0 260 150">
      <path d="${path}" fill="none" stroke="var(--track)" stroke-width="18" stroke-linecap="round" />
      <path d="${path}" fill="none" stroke="${color(verdict)}" stroke-width="18" stroke-linecap="round"
            stroke-dasharray="${frac * len} ${len}" />
      <text x="130" y="118" text-anchor="middle" font-size="34" font-weight="700" fill="${color(verdict)}">
        ${rating.toFixed(1)}
      </text>
    </svg>`;
}

function legendHtml() {
  const items = [
    ['Skip', '--skip'],
    ['Timepass', '--timepass'],
    ['Go For It', '--goforit'],
    ['Perfection', '--perfection'],
  ];
  return `<div class="legend">${items
    .map(([label, v]) => `<span><i class="dot" style="background:var(${v})"></i>${label}</span>`)
    .join('')}</div>`;
}

// Chips link to the TMDB watch page (TMDB's JustWatch licence forbids deep-linking the provider).
function providerChips(list, link) {
  const href = link ? ` href="${escapeHtml(link)}" target="_blank" rel="noopener"` : '';
  return list
    .map(
      (p) =>
        `<a class="prov"${href}>${p.logoUrl ? `<img src="${escapeHtml(p.logoUrl)}" alt="" />` : ''}<span>${escapeHtml(p.name)}</span></a>`,
    )
    .join('');
}

function watchHtml(w) {
  if (!w) return '';
  const groups = [
    ['flatrate', 'Stream'],
    // Rent + Buy are hidden by default — uncomment to show purchase/rental options too:
    // ['rent', 'Rent'],
    // ['buy', 'Buy'],
  ]
    .filter(([k]) => w[k] && w[k].length)
    .map(([k, label]) => `<div class="kind">${label}</div><div class="providers">${providerChips(w[k], w.link)}</div>`)
    .join('');
  if (!groups) return '';
  const head = w.link
    ? `<a class="watch-link" href="${escapeHtml(w.link)}" target="_blank" rel="noopener">Where to watch on TMDB ↗</a>`
    : '';
  return `<div class="watch"><h4>Where to watch</h4>${groups}</div>${head}`;
}

function trailerHtml(url) {
  return url
    ? `<a class="trailer" href="${escapeHtml(url)}" target="_blank" rel="noopener">▶ Watch trailer</a>`
    : '';
}

function posterHtml(url) {
  return url ? `<img class="poster" src="${escapeHtml(url)}" alt="" />` : '';
}

function titleLine(data) {
  const type = data.type ? ` · ${escapeHtml(data.type)}` : '';
  const lang = data.language ? ` · ${escapeHtml(String(data.language).toUpperCase())}` : '';
  return `<div class="rating">${escapeHtml(data.title)}${type}${data.year ? ` · ${data.year}` : ''}${lang}</div>`;
}

// Highlighted director + lead actor block.
function creditsHtml(data) {
  const rows = [
    data.director ? `<div class="cr"><span class="cr-k">🎬 Director</span><span class="cr-v">${escapeHtml(data.director)}</span></div>` : '',
    data.leadActor ? `<div class="cr"><span class="cr-k">🎭 Lead</span><span class="cr-v">${escapeHtml(data.leadActor)}</span></div>` : '',
  ].join('');
  return rows ? `<div class="credits">${rows}</div>` : '';
}

function awardsHtml(data) {
  return data.awards ? `<div class="awards">🏆 ${escapeHtml(data.awards)}</div>` : '';
}

// Compact vote count: 2547891 → "2.5M", 12000 → "12K", 3 → "3".
function fmtCount(n) {
  if (!n || n < 1) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}

// "TMDB 8.4 (12K) · IMDb 8.8 (2.5M)". Each source shown only when it has a rating.
function ratingsLine(data) {
  const parts = [];
  if (data.tmdbRating > 0) {
    const c = fmtCount(data.voteCount);
    parts.push(`TMDB ${data.tmdbRating.toFixed(1)}${c ? ` (${c})` : ''}`);
  }
  if (data.imdbRating) {
    const votes = data.imdbVotes ? Number(String(data.imdbVotes).replace(/[^0-9]/g, '')) : 0;
    const c = fmtCount(votes);
    parts.push(`IMDb ${escapeHtml(String(data.imdbRating))}${c ? ` (${c})` : ''}`);
  }
  if (data.rottenTomatoes) parts.push(`🍅 ${escapeHtml(String(data.rottenTomatoes))}`);
  if (data.metascore) parts.push(`Ⓜ ${escapeHtml(String(data.metascore))}`);
  return parts.length ? `<div class="rating scores">${parts.join(' · ')}</div>` : '';
}

function watchlistBtnHtml(data) {
  const added = data.onWatchlist;
  return `<button class="wl-add" data-title="${escapeHtml(data.title)}"
      data-year="${data.year ?? ''}" data-type="${escapeHtml(data.type || 'Movie')}"${added ? ' disabled' : ''}>${
        added ? '✓ On your watchlist' : '＋ Add to watchlist'
      }</button>
    <button class="ghost" id="score-mylist">📋 My watchlist</button>`;
}

// A released film with almost no votes has a meaningless rating (0 → would read "Skip"). Show it
// as unrated instead of a bogus verdict.
const MIN_VOTES = 5;

// "Not this title?" lives in the header (see index) — shown only when a title is on screen, so the
// user can jump to manual search (pre-filled) whenever detection is wrong. currentGuess feeds it.
let currentGuess = null;
function toggleNotThis(title) {
  const btn = document.getElementById('not-this');
  if (!btn) return;
  currentGuess = title || null;
  btn.hidden = !title;
}

// Poster + title + a muted status line, no verdict/taste. Shared by "Not out yet" and "Too new".
function renderStatus(data, status) {
  view.innerHTML = `
    <div class="hero">
      ${posterHtml(data.posterUrl)}
      <div class="hero-main">
        <div class="verdict" style="color:var(--muted)">${status.headline}</div>
        ${titleLine(data)}
        ${status.sub ? `<div class="rating">${status.sub}</div>` : ''}
        ${ratingsLine(data)}
      </div>
    </div>
    ${creditsHtml(data)}
    ${trailerHtml(data.trailerUrl)}
    ${watchlistBtnHtml(data)}`;
  bindWatchlistAdd();
  toggleNotThis(data.title);
}

function renderScore(data) {
  // Not released yet → no verdict (no rating exists); show the date instead.
  if (data.released === false) {
    return renderStatus(data, {
      headline: 'Not out yet',
      sub: data.releaseDate ? `🍿 Releases ${escapeHtml(data.releaseDate)}` : '',
    });
  }
  // Released but effectively unrated → the TMDB average is noise; show that instead of a verdict.
  // tmdbRating 0 means "no votes" on TMDB (no real film averages exactly 0), which also covers
  // cache entries stored before voteCount existed; voteCount < MIN catches new films with a few
  // noisy votes (a non-zero average from 2 people).
  const unrated = data.tmdbRating === 0 || (typeof data.voteCount === 'number' && data.voteCount < MIN_VOTES);
  if (unrated) {
    return renderStatus(data, { headline: '🆕 Too new', sub: 'Not enough ratings yet' });
  }

  const taste = data.tasteMatch
    ? `<div class="taste ${data.tasteMatch.level}">${data.tasteMatch.message}</div>`
    : '';
  view.innerHTML = `
    <div class="hero">
      ${posterHtml(data.posterUrl)}
      <div class="hero-main">
        ${gaugeSvg(data.tmdbRating, data.verdict)}
        <div class="verdict" style="color:${color(data.verdict)}">${data.verdict}</div>
        ${titleLine(data)}
        ${ratingsLine(data)}
      </div>
    </div>
    ${creditsHtml(data)}
    ${taste}
    ${awardsHtml(data)}
    ${legendHtml()}
    ${trailerHtml(data.trailerUrl)}
    ${watchlistBtnHtml(data)}
    ${watchHtml(data.watch)}`;
  bindWatchlistAdd();
  toggleNotThis(data.title);
}

function bindWatchlistAdd() {
  const btn = view.querySelector('.wl-add');
  const myList = view.querySelector('#score-mylist');
  if (myList) {
    // Back from the list returns to this movie (re-score it), not the search box.
    myList.addEventListener('click', () => {
      const title = btn?.dataset.title;
      const year = btn?.dataset.year ? Number(btn.dataset.year) : undefined;
      renderWatchlist(title ? () => scoreTitle(title, year) : undefined);
    });
  }
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
      const body = {
        title: btn.dataset.title,
        type: btn.dataset.type,
        year: btn.dataset.year ? Number(btn.dataset.year) : undefined,
      };
      const res = await fetch(`${await backendUrl()}/watchlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('failed');
      btn.textContent = '✓ On your watchlist';
    } catch {
      btn.disabled = false;
      btn.textContent = 'Couldn’t add — retry';
    }
  });
}

function renderManual(message, prefill) {
  toggleNotThis(null); // already in search view — no "not this?" needed
  view.innerHTML = `
    ${message ? `<p class="muted center">${message}</p>` : ''}
    <form id="search">
      <input id="q" placeholder="Movie or show title…" value="${prefill ? escapeHtml(prefill) : ''}" autofocus />
      <button type="submit">Check</button>
    </form>
    <button class="ghost" id="show-watchlist">📋 My watchlist</button>
    <p class="muted" style="margin:14px 0 4px">Or pick a mood:</p>
    <div class="moods">${MOODS.map((m) => `<button class="mood" data-mood="${m}">${m}</button>`).join('')}</div>
    <div id="recs"></div>`;

  const input = document.getElementById('q');
  if (prefill) input.select(); // ready to overwrite the wrong guess
  document.getElementById('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) pickTitle(q); // manual correction → remember it for this tab
  });
  document.getElementById('show-watchlist').addEventListener('click', renderWatchlist);
  document.querySelectorAll('.mood').forEach((btn) =>
    btn.addEventListener('click', () => recommend(btn.dataset.mood)),
  );
}

// "My list": the watchlist, scored + taste-ranked. Click an item to re-score it, ✕ to remove.
// `back` returns to wherever you opened it from (the movie you were on, or the search view).
async function renderWatchlist(back) {
  toggleNotThis(null);
  const goBack = typeof back === 'function' ? back : () => renderManual();
  view.innerHTML = `<p class="muted center">Loading your watchlist…</p>`;
  try {
    const res = await fetch(`${await backendUrl()}/watchlist`);
    const body = await res.json();
    if (!body.success) throw new Error(body.error?.message || 'Request failed');
    const items = body.data;
    const chip = (r) =>
      r.released === false
        ? `<span class="chip chip-upcoming">Upcoming</span>`
        : `<span class="chip" style="background:${color(r.verdict)};color:#0a0a0a">${r.verdict}</span>`;
    const list = items.length
      ? items
          .map(
            (r) => `<div class="rec wl-item" data-title="${escapeHtml(r.title)}" data-year="${r.year ?? ''}">
              ${r.posterUrl ? `<img class="wl-thumb" src="${escapeHtml(r.posterUrl)}" alt="" />` : '<span class="wl-thumb wl-thumb-empty"></span>'}
              <span role="button" tabindex="0" class="rec-open wl-meta">
                <span class="wl-title">${escapeHtml(r.title)}${r.year ? ` · ${r.year}` : ''}</span>
                ${r.director ? `<span class="wl-dir">${escapeHtml(r.director)}</span>` : ''}
              </span>
              ${chip(r)}
              <button class="wl-remove" title="Remove" aria-label="Remove">✕</button>
            </div>`,
          )
          .join('')
      : `<p class="muted center">Your watchlist is empty. Add titles from any movie page.</p>`;
    view.innerHTML = `<button class="ghost" id="wl-back">← Back</button><div id="recs">${list}</div>`;

    document.getElementById('wl-back').addEventListener('click', goBack);
    view.querySelectorAll('.rec').forEach((el) => {
      const title = el.dataset.title;
      const year = el.dataset.year ? Number(el.dataset.year) : undefined;
      el.querySelector('.rec-open').addEventListener('click', () => pickTitle(title, year));
      el.querySelector('.wl-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        await fetch(`${await backendUrl()}/watchlist`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, year }),
        });
        renderWatchlist();
      });
    });
  } catch (err) {
    renderManual(`Couldn’t load watchlist (${escapeHtml(err.message)})`);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function scoreTitle(title, year) {
  view.innerHTML = `<p class="muted center">Scoring “${escapeHtml(title)}”…</p>`;
  try {
    const q = `title=${encodeURIComponent(title)}${year ? `&year=${year}` : ''}`;
    const res = await fetch(`${await backendUrl()}/score?${q}`);
    const body = await res.json();
    if (res.status === 404) return renderManual(`No match for “${escapeHtml(title)}”. Try another title:`);
    if (!body.success) throw new Error(body.error?.message || 'Request failed');
    renderScore(body.data);
  } catch (err) {
    renderManual(`Couldn’t reach the backend. Is it running? (${escapeHtml(err.message)})`);
  }
}

async function recommend(mood) {
  const recs = document.getElementById('recs');
  recs.innerHTML = `<p class="muted">Finding ${mood} picks…</p>`;
  try {
    const res = await fetch(`${await backendUrl()}/recommend?mood=${encodeURIComponent(mood)}`);
    const body = await res.json();
    if (!body.success) throw new Error(body.error?.message || 'Request failed');
    recs.innerHTML = body.data
      .map(
        (r) => `<div class="rec" role="button" tabindex="0" data-title="${escapeHtml(r.title)}">
          <span>${escapeHtml(r.title)}</span>
          <span class="chip" style="background:${color(r.verdict)};color:#0a0a0a">${r.verdict}</span></div>`,
      )
      .join('');
    // Click / Enter a pick → score it (and remember it for this tab).
    recs.querySelectorAll('.rec').forEach((el) => {
      const go = () => pickTitle(el.dataset.title);
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });
  } catch (err) {
    recs.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

// --- Per-tab title override ---------------------------------------------------------------------
// Auto-detection is best-effort (esp. on YouTube / same-name titles). When it's wrong, the user
// corrects it via the "Not this?" button → manual search; we remember that choice for THIS tab so
// reopening the popup shows the corrected title instead of re-detecting. Kept in session storage
// (clears when the browser closes) and scoped to the tab's current URL, so navigating away in the
// same tab re-detects rather than showing a stale correction.
let activeTab = null;

function overrideKey() {
  return activeTab?.id != null ? `ov_${activeTab.id}` : null;
}
async function getOverride() {
  const key = overrideKey();
  if (!key) return null;
  const store = await chrome.storage.session.get(key);
  const ov = store[key];
  return ov && ov.url === activeTab.url ? ov : null;
}
async function setOverride(title, year) {
  const key = overrideKey();
  if (key) await chrome.storage.session.set({ [key]: { url: activeTab.url, title, year } });
}

// User explicitly chose a title (search / pick) for this tab → persist it, then score.
function pickTitle(title, year) {
  setOverride(title, year);
  scoreTitle(title, year);
}

// Ask the content script for a detected title. On sites with no auto-injected content script
// (only 7 are listed in the manifest), inject it on demand via chrome.scripting (activeTab covers
// the current tab) and retry — so detection works on any site, not just the built-in ones.
function detectFromPage() {
  if (!activeTab?.id) return renderManual();
  askForTitle((resp, hadReceiver) => {
    if (resp?.title) return scoreTitle(resp.title, resp.year);
    // A content script answered but found no title (e.g. Google with no knowledge panel) → go manual.
    // Only inject when nothing answered (no content script on this site) — injecting into a page that
    // already has the script re-runs it and throws a redeclare error.
    if (hadReceiver) return renderManual('No movie/show detected');
    chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] }, () => {
      if (chrome.runtime.lastError) return renderManual('No movie/show detected'); // restricted page
      askForTitle((r2) => (r2?.title ? scoreTitle(r2.title, r2.year) : renderManual('No movie/show detected')));
    });
  });
}
function askForTitle(cb) {
  chrome.tabs.sendMessage(activeTab.id, { type: 'DETECT_TITLE' }, (resp) => {
    const hadReceiver = !chrome.runtime.lastError; // false = no content script listening
    cb(hadReceiver ? resp : null, hadReceiver);
  });
}

async function start() {
  document
    .getElementById('not-this')
    ?.addEventListener('click', () => renderManual('Search for the right title:', currentGuess));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  const ov = await getOverride();
  if (ov) return scoreTitle(ov.title, ov.year); // user's correction for this tab wins
  detectFromPage();
}

start();
