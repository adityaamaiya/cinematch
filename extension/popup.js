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

function providerChips(list) {
  return list
    .map(
      (p) =>
        `<span class="prov">${p.logoUrl ? `<img src="${escapeHtml(p.logoUrl)}" alt="" />` : ''}<span>${escapeHtml(p.name)}</span></span>`,
    )
    .join('');
}

// Where-to-watch (JustWatch via TMDB). Licence: link to the TMDB watch page, don't deep-link providers.
function watchHtml(w) {
  if (!w) return '';
  const groups = [
    ['flatrate', 'Stream'],
    ['rent', 'Rent'],
    ['buy', 'Buy'],
  ]
    .filter(([k]) => w[k] && w[k].length)
    .map(([k, label]) => `<div class="kind">${label}</div><div class="providers">${providerChips(w[k])}</div>`)
    .join('');
  if (!groups) return '';
  const head = w.link
    ? `<a class="trailer" style="background:#16161a;border:1px solid #2a2a30;color:var(--fg)" href="${escapeHtml(w.link)}" target="_blank" rel="noopener">Where to watch ↗</a>`
    : '';
  return `<div class="watch"><h4>Where to watch</h4>${groups}</div>${head}`;
}

function trailerHtml(url) {
  return url
    ? `<a class="trailer" href="${escapeHtml(url)}" target="_blank" rel="noopener">▶ Watch trailer</a>`
    : '';
}

function renderScore(data) {
  const taste = data.tasteMatch
    ? `<div class="taste" style="color:${color(data.verdict)}">${data.tasteMatch.message}</div>`
    : '';
  view.innerHTML = `
    <div class="center">
      ${gaugeSvg(data.tmdbRating, data.verdict)}
      <div class="verdict" style="color:${color(data.verdict)}">${data.verdict}</div>
      <div class="rating">${escapeHtml(data.title)}${data.year ? ` · ${data.year}` : ''} · TMDB ${data.tmdbRating.toFixed(1)}/10</div>
    </div>
    ${taste}
    ${trailerHtml(data.trailerUrl)}
    ${watchHtml(data.watch)}
    ${legendHtml()}`;
}

function renderManual(message) {
  view.innerHTML = `
    ${message ? `<p class="muted center">${message}</p>` : ''}
    <form id="search">
      <input id="q" placeholder="Movie or show title…" autofocus />
      <button type="submit">Check</button>
    </form>
    <p class="muted" style="margin:14px 0 4px">Or pick a mood:</p>
    <div class="moods">${MOODS.map((m) => `<button class="mood" data-mood="${m}">${m}</button>`).join('')}</div>
    <div id="recs"></div>`;

  document.getElementById('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim();
    if (q) scoreTitle(q);
  });
  document.querySelectorAll('.mood').forEach((btn) =>
    btn.addEventListener('click', () => recommend(btn.dataset.mood)),
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function scoreTitle(title) {
  view.innerHTML = `<p class="muted center">Scoring “${escapeHtml(title)}”…</p>`;
  try {
    const res = await fetch(`${await backendUrl()}/score?title=${encodeURIComponent(title)}`);
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
        (r) => `<div class="rec"><span>${escapeHtml(r.title)}</span>
          <span class="chip" style="background:${color(r.verdict)};color:#0a0a0a">${r.verdict}</span></div>`,
      )
      .join('');
  } catch (err) {
    recs.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

// Ask the content script for a detected title; fall back to manual on any failure.
async function detect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return renderManual();
  chrome.tabs.sendMessage(tab.id, { type: 'DETECT_TITLE' }, (resp) => {
    if (chrome.runtime.lastError || !resp?.title) renderManual('No movie detected on this page.');
    else scoreTitle(resp.title);
  });
}

detect();
