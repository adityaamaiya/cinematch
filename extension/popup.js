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
  const lang = data.language ? ` · ${escapeHtml(String(data.language).toUpperCase())}` : '';
  return `<div class="rating">${escapeHtml(data.title)}${data.year ? ` · ${data.year}` : ''}${lang}</div>`;
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

function ratingsLine(data) {
  const tmdb = `TMDB ${data.tmdbRating.toFixed(1)}`;
  const imdb = data.imdbRating ? ` · IMDb ${escapeHtml(String(data.imdbRating))}` : '';
  return `<div class="rating">${tmdb}${imdb}</div>`;
}

function watchlistBtnHtml(data) {
  const added = data.onWatchlist;
  return `<button class="wl-add" data-title="${escapeHtml(data.title)}"
      data-year="${data.year ?? ''}" data-type="${escapeHtml(data.type || 'Movie')}"${added ? ' disabled' : ''}>${
        added ? '✓ On your watchlist' : '＋ Add to watchlist'
      }</button>
    <button class="ghost" id="score-mylist">📋 My watchlist</button>`;
}

function renderScore(data) {
  // Not released yet → no verdict (no rating exists); show the date instead.
  if (data.released === false) {
    view.innerHTML = `
      <div class="hero">
        ${posterHtml(data.posterUrl)}
        <div class="hero-main">
          <div class="verdict" style="color:var(--muted)">Not out yet</div>
          ${titleLine(data)}
          ${data.releaseDate ? `<div class="rating">🍿 Releases ${escapeHtml(data.releaseDate)}</div>` : ''}
        </div>
      </div>
      ${creditsHtml(data)}
      ${trailerHtml(data.trailerUrl)}
      ${watchlistBtnHtml(data)}`;
    bindWatchlistAdd();
    return;
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

function renderManual(message) {
  view.innerHTML = `
    ${message ? `<p class="muted center">${message}</p>` : ''}
    <form id="search">
      <input id="q" placeholder="Movie or show title…" autofocus />
      <button type="submit">Check</button>
    </form>
    <button class="ghost" id="show-watchlist">📋 My watchlist</button>
    <p class="muted" style="margin:14px 0 4px">Or pick a mood:</p>
    <div class="moods">${MOODS.map((m) => `<button class="mood" data-mood="${m}">${m}</button>`).join('')}</div>
    <div id="recs"></div>`;

  document.getElementById('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim();
    if (q) scoreTitle(q);
  });
  document.getElementById('show-watchlist').addEventListener('click', renderWatchlist);
  document.querySelectorAll('.mood').forEach((btn) =>
    btn.addEventListener('click', () => recommend(btn.dataset.mood)),
  );
}

// "My list": the watchlist, scored + taste-ranked. Click an item to re-score it, ✕ to remove.
// `back` returns to wherever you opened it from (the movie you were on, or the search view).
async function renderWatchlist(back) {
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
      el.querySelector('.rec-open').addEventListener('click', () => scoreTitle(title, year));
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
    // Click / Enter a pick → score it.
    recs.querySelectorAll('.rec').forEach((el) => {
      const go = () => scoreTitle(el.dataset.title);
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

// Ask the content script for a detected title; fall back to manual on any failure.
async function detect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return renderManual();
  chrome.tabs.sendMessage(tab.id, { type: 'DETECT_TITLE' }, (resp) => {
    if (chrome.runtime.lastError || !resp?.title) renderManual('No movie/show detected');
    else scoreTitle(resp.title, resp.year);
  });
}

detect();
