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

// Inline Lucide-style icons (stroke = currentColor, so they inherit each button's colour). Emoji
// looked inconsistent across platforms; these render identically everywhere.
const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
};
function ic(name) {
  return `<svg class="ic" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

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
  if (btn) btn.innerHTML = effectiveTheme() === 'light' ? ic('sun') : ic('moon');
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

// Half-donut gauge arching over BOTH the rating number and the verdict, all in the verdict colour.
// The arc fills to rating/10 over a faint same-colour track.
function scoreNum(rating, verdict) {
  const col = color(verdict);
  const R = 98; // arc radius; endpoints (12,112)–(208,112), sweep 1 = over the top
  const LEN = Math.PI * R; // semicircle length
  const fill = ((Math.max(0, Math.min(10, rating)) / 10) * LEN).toFixed(1);
  const arc = `M12,112 A${R},${R} 0 0 1 208,112`;
  return `
    <div class="score-gauge">
      <svg class="gauge-svg" viewBox="0 0 220 124" width="220" height="124" aria-hidden="true">
        <path d="${arc}" fill="none" stroke="${col}" stroke-opacity=".18" stroke-width="10" stroke-linecap="round"/>
        <path d="${arc}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${fill} 999"/>
      </svg>
      <div class="gauge-inner">
        <div id="score-num" class="score-num" style="color:${col}">${rating.toFixed(1)}</div>
        <div class="verdict" style="color:${col}">${verdict}</div>
      </div>
    </div>`;
}

// The personalised taste line (LLM "% match — why", or the statistical level message). Shown on the
// verdict view AND the "Not out yet" / "Too new" views — taste doesn't need a rating to exist.
const TASTE_EMOJI = { strong: '🎯', mild: '👍', mismatch: '😕' };
// Headline when the model gave a level but no numeric score.
const TASTE_FALLBACK = { strong: 'Strong match', mild: 'Likely for you', mismatch: 'Not your taste' };

// Taste "meter card": emoji chip + "NN% match" + why, with a thin fill-bar showing the match %.
function tasteHtml(data) {
  const t = data.tasteMatch;
  if (!t) return '';
  const emoji = TASTE_EMOJI[t.level] || '🎯';
  const hasScore = typeof t.score === 'number';
  const head = hasScore ? `${t.score}% match` : TASTE_FALLBACK[t.level] || 'For you';
  const why = t.why ? `<div class="taste-why">${escapeHtml(t.why)}</div>` : '';
  const bar = hasScore ? `<div class="taste-bar" style="width:${t.score}%"></div>` : '';
  // `via` is set only when a fallback model answered (primary exhausted) — small corner label.
  const via = t.via ? `<span class="taste-via">via ${escapeHtml(t.via)}</span>` : '';
  return `
    <div class="taste ${t.level}">
      <div class="taste-ico">${emoji}</div>
      <div class="taste-txt"><div class="taste-head">${escapeHtml(head)}</div>${why}</div>
      ${bar}${via}
    </div>`;
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
    ? `<a class="watch-link" href="${escapeHtml(w.link)}" target="_blank" rel="noopener">Where to watch on TMDB ${ic('external')}</a>`
    : '';
  return `<div class="watch"><h4>Where to watch</h4>${groups}</div>${head}`;
}

function trailerHtml(url) {
  return url
    ? `<a class="trailer" href="${escapeHtml(url)}" target="_blank" rel="noopener">${ic('play')} Watch trailer</a>`
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

// Two lines: audience scores (TMDB · IMDb, with vote counts) on top, critic scores
// (Rotten Tomatoes · Metacritic — OMDb gives no count for these) below.
function ratingsLine(data) {
  const audience = [];
  if (data.tmdbRating > 0) {
    const c = fmtCount(data.voteCount);
    audience.push(`TMDB ${data.tmdbRating.toFixed(1)}${c ? ` (${c})` : ''}`);
  }
  if (data.imdbRating) {
    const votes = data.imdbVotes ? Number(String(data.imdbVotes).replace(/[^0-9]/g, '')) : 0;
    const c = fmtCount(votes);
    audience.push(`IMDb ${escapeHtml(String(data.imdbRating))}${c ? ` (${c})` : ''}`);
  }
  const critics = [];
  if (data.rottenTomatoes) critics.push(`🍅 ${escapeHtml(String(data.rottenTomatoes))}`);
  if (data.metascore) critics.push(`Ⓜ ${escapeHtml(String(data.metascore))}`);

  return (
    (audience.length ? `<div class="rating">${audience.join(' · ')}</div>` : '') +
    (critics.length ? `<div class="rating">${critics.join(' · ')}</div>` : '')
  );
}

function watchlistBtnHtml(data) {
  const added = data.onWatchlist;
  return `<button class="wl-add" data-title="${escapeHtml(data.title)}"
      data-year="${data.year ?? ''}" data-type="${escapeHtml(data.type || 'Movie')}"${added ? ' disabled' : ''}>${
        added ? `${ic('check')} On your watchlist` : `${ic('plus')} Add to watchlist`
      }</button>`;
}

// "Rate this" — four verdict chips (your own rating, not the objective verdict). The stored rating
// (data.userVerdict) is pre-highlighted. Below: rebuild the taste profile, and jump to "My ratings".
function rateSectionHtml(data) {
  const chips = ['Skip', 'Timepass', 'Go For It', 'Perfection']
    .map((v) => {
      const active = data.userVerdict === v ? ' active' : '';
      return `<button class="rate-chip${active}" data-verdict="${escapeHtml(v)}" style="--rc:var(${VERDICT_VAR[v]})">${v}</button>`;
    })
    .join('');
  return `
    <div class="rate">
      <div class="rate-label">${data.userVerdict ? 'Your rating' : 'Rate this'}</div>
      <div class="rate-row">${chips}</div>
    </div>`;
}

// My watchlist + My ratings side by side (one row). Handlers are bound by id in bindWatchlistAdd /
// bindRate, so placement here is free.
function listNavHtml() {
  return `<div class="list-nav">
      <button class="ghost" id="score-mylist">${ic('bookmark')} My watchlist</button>
      <button class="ghost" id="show-ratings">${ic('star')} My ratings</button>
    </div>`;
}

// "Refresh taste" lives on its own at the very bottom (after watch providers) so it isn't mis-clicked
// while rating or opening a list — it's an AI call + full rebuild (also guarded by a confirm).
function refreshTasteBtnHtml() {
  return `<button class="ghost" id="refresh-taste" style="margin-top:16px">${ic('refresh')} Refresh taste profile</button>`;
}

function bindRate(data) {
  const chips = [...view.querySelectorAll('.rate-chip')];
  chips.forEach((btn) =>
    btn.addEventListener('click', async () => {
      const prev = view.querySelector('.rate-chip.active');
      chips.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      try {
        const res = await fetch(`${await backendUrl()}/rate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: data.title,
            type: data.type || 'Movie',
            year: data.year,
            verdict: btn.dataset.verdict,
            posterUrl: data.posterUrl,
            director: data.director,
          }),
        });
        if (!res.ok) throw new Error('failed');
        view.querySelector('.rate-label').textContent = 'Your rating';
      } catch {
        // Revert to the previous selection on failure.
        btn.classList.remove('active');
        if (prev) prev.classList.add('active');
      }
    }),
  );

  // Manual taste-profile rebuild → re-score this title so the fresh taste line shows.
  // Confirm first: it's one AI (Gemini) call + a full profile rebuild, so guard accidental clicks.
  view.querySelector('#refresh-taste')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!window.confirm('Rebuild your taste profile from all your ratings? (uses one AI call)')) return;
    btn.disabled = true;
    btn.textContent = 'Rebuilding taste…';
    try {
      await fetch(`${await backendUrl()}/regenerate-taste`, { method: 'POST' });
      scoreTitle(data.title, data.year);
    } catch {
      btn.disabled = false;
      btn.textContent = '↻ Refresh taste';
    }
  });

  view
    .querySelector('#show-ratings')
    ?.addEventListener('click', () => renderRatings(() => scoreTitle(data.title, data.year)));
}

// "My ratings": the raw ratings list, newest first (verdict chip + optional poster thumb). Click an
// item to re-score it (the enriched view, where you can re-rate). `back` returns where you opened it.
// --- shared list search + verdict filter (watchlist / ratings) ---
const FILTER_VERDICTS = ['Skip', 'Timepass', 'Go For It', 'Perfection'];
function filterBarHtml() {
  const chips = [['', 'All'], ...FILTER_VERDICTS.map((v) => [v, v])]
    .map(([val, label]) => {
      const rc = val ? ` style="--rc:var(${VERDICT_VAR[val]})"` : '';
      return `<button class="vf${val === '' ? ' active' : ''}" data-v="${escapeHtml(val)}"${rc}>${label}</button>`;
    })
    .join('');
  return `<div class="list-filter">
      <input class="list-search" placeholder="Search title…" />
      <div class="vf-row">${chips}</div>
    </div>`;
}
// Wire the filter bar; onChange(state) fires on search input (debounced) + verdict-chip clicks.
function bindFilterBar(root, onChange) {
  const state = { q: '', verdict: '' };
  const search = root.querySelector('.list-search');
  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = search.value;
      onChange(state);
    }, 180);
  });
  root.querySelectorAll('.vf').forEach((btn) =>
    btn.addEventListener('click', () => {
      root.querySelectorAll('.vf').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.verdict = btn.dataset.v;
      onChange(state);
    }),
  );
  return state;
}

// Bind "open → re-score" on new rows (ratings + recommend rows; no remove button).
function bindOpenRows(recs) {
  recs.querySelectorAll('.rec:not([data-bound])').forEach((el) => {
    el.dataset.bound = '1';
    const title = el.dataset.title;
    const year = el.dataset.year ? Number(el.dataset.year) : undefined;
    el.querySelector('.rec-open').addEventListener('click', () => pickTitle(title, year));
  });
}

// Generic BE-paged + BE-filtered + infinite-scroll list, shared by My ratings & My watchlist. The
// server filters by ?q&verdict and paginates; we append pages and refetch from page 0 on filter
// change. An IntersectionObserver on the sentinel loads the next page as it scrolls into view.
async function renderPagedList({ endpoint, back, rowHtml, bindRow, emptyMsg }) {
  toggleNotThis(null);
  const goBack = typeof back === 'function' ? back : () => renderManual();
  view.innerHTML = `
    <button class="ghost" id="pl-back">${ic('arrowLeft')} Back</button>
    ${filterBarHtml()}
    <div id="recs"></div>
    <p class="muted center" id="pl-more" hidden></p>`;
  document.getElementById('pl-back').addEventListener('click', goBack);
  const recs = document.getElementById('recs');
  const more = document.getElementById('pl-more');

  let q = '';
  let verdict = '';
  let page = 0;
  let hasMore = true;
  let loading = false;

  async function loadNext() {
    if (loading || !hasMore) return;
    loading = true;
    more.hidden = false;
    more.textContent = 'Loading…';
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (q) params.set('q', q);
      if (verdict) params.set('verdict', verdict);
      const res = await fetch(`${await backendUrl()}${endpoint}?${params}`);
      const body = await res.json();
      if (!body.success) throw new Error(body.error?.message || 'Request failed');
      body.data.items.forEach((r) => recs.insertAdjacentHTML('beforeend', rowHtml(r)));
      bindRow(recs);
      hasMore = body.data.hasMore;
      page += 1;
      loading = false;
      if (hasMore) {
        more.hidden = false; // keep the sentinel visible so the observer can fire on scroll
        more.textContent = 'Loading…';
      } else if (recs.children.length === 0) {
        more.hidden = false;
        more.textContent = q || verdict ? 'No matches.' : emptyMsg;
      } else {
        more.hidden = true;
      }
    } catch (err) {
      loading = false;
      hasMore = false;
      more.hidden = false;
      more.textContent = `Couldn’t load (${escapeHtml(err.message)})`;
    }
  }

  // Filter/search change → reset and refetch from the server (BE-driven).
  bindFilterBar(view, (state) => {
    q = state.q;
    verdict = state.verdict;
    page = 0;
    hasMore = true;
    recs.innerHTML = '';
    loadNext();
  });

  const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadNext(), {
    root: view,
    rootMargin: '150px',
  });
  io.observe(more);
  await loadNext();
}

// One ratings row (user's own verdict + poster snapshot). Click → re-score (enriched view).
function ratingRowHtml(r) {
  return `<div class="rec wl-item" data-title="${escapeHtml(r.title)}" data-year="${r.year ?? ''}">
      ${r.posterUrl ? `<img class="wl-thumb" src="${escapeHtml(r.posterUrl)}" alt="" />` : '<span class="wl-thumb wl-thumb-empty"></span>'}
      <span role="button" tabindex="0" class="rec-open wl-meta">
        <span class="wl-title">${escapeHtml(r.title)}${r.year ? ` · ${r.year}` : ''}</span>
        ${r.director ? `<span class="wl-dir">${escapeHtml(r.director)}</span>` : ''}
      </span>
      <span class="chip" style="background:${color(r.verdict)};color:#0a0a0a">${escapeHtml(r.verdict)}</span>
    </div>`;
}

function renderRatings(back) {
  return renderPagedList({
    endpoint: '/ratings',
    back,
    rowHtml: ratingRowHtml,
    bindRow: bindOpenRows,
    emptyMsg: 'No ratings yet. Rate titles from any movie page.',
  });
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
    ${tasteHtml(data)}
    ${data.released !== false ? rateSectionHtml(data) : ''}
    ${listNavHtml()}
    ${trailerHtml(data.trailerUrl)}
    ${watchlistBtnHtml(data)}
    ${refreshTasteBtnHtml()}`;
  bindWatchlistAdd(data);
  // Rate chips only when released (can't rate a not-out-yet title); bindRate still wires the nav +
  // Refresh buttons and no-ops on the absent chips.
  bindRate(data);
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

  view.innerHTML = `
    <div class="hero">
      ${posterHtml(data.posterUrl)}
      <div class="hero-main">
        ${scoreNum(data.tmdbRating, data.verdict)}
        ${titleLine(data)}
        ${ratingsLine(data)}
        ${legendHtml()}
      </div>
    </div>
    ${creditsHtml(data)}
    ${awardsHtml(data)}
    ${tasteHtml(data)}
    ${rateSectionHtml(data)}
    ${listNavHtml()}
    ${trailerHtml(data.trailerUrl)}
    ${watchlistBtnHtml(data)}
    ${watchHtml(data.watch)}
    ${refreshTasteBtnHtml()}`;
  bindWatchlistAdd(data);
  bindRate(data);
  toggleNotThis(data.title);
}

function bindWatchlistAdd(data) {
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
      // Snapshot the enriched /score data so the watchlist list renders with no TMDB call.
      const body = {
        title: btn.dataset.title,
        type: btn.dataset.type,
        year: btn.dataset.year ? Number(btn.dataset.year) : undefined,
        verdict: data?.released !== false ? data?.verdict : undefined,
        tmdbRating: typeof data?.tmdbRating === 'number' ? data.tmdbRating : undefined,
        posterUrl: data?.posterUrl,
        director: data?.director,
        releaseDate: data?.releaseDate,
      };
      const res = await fetch(`${await backendUrl()}/watchlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('failed');
      btn.disabled = true;
      btn.innerHTML = `${ic('check')} On your watchlist`;
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
    <div class="list-nav">
      <button class="ghost" id="show-watchlist">${ic('bookmark')} My watchlist</button>
      <button class="ghost" id="show-ratings">${ic('star')} My ratings</button>
    </div>
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
  document.getElementById('show-ratings').addEventListener('click', () => renderRatings());
  document.querySelectorAll('.mood').forEach((btn) =>
    btn.addEventListener('click', () => recommend(btn.dataset.mood)),
  );
}

// "My list": the watchlist, scored + taste-ranked. Click an item to re-score it, ✕ to remove.
// `back` returns to wherever you opened it from (the movie you were on, or the search view).
// One watchlist row (scored + poster thumb). Verdict chip, or "Upcoming" for unreleased.
function wlRowHtml(r) {
  const chip =
    r.released === false
      ? `<span class="chip chip-upcoming">Upcoming</span>`
      : `<span class="chip" style="background:${color(r.verdict)};color:#0a0a0a">${r.verdict}</span>`;
  return `<div class="rec wl-item" data-title="${escapeHtml(r.title)}" data-year="${r.year ?? ''}">
      ${r.posterUrl ? `<img class="wl-thumb" src="${escapeHtml(r.posterUrl)}" alt="" />` : '<span class="wl-thumb wl-thumb-empty"></span>'}
      <span role="button" tabindex="0" class="rec-open wl-meta">
        <span class="wl-title">${escapeHtml(r.title)}${r.year ? ` · ${r.year}` : ''}</span>
        ${r.director ? `<span class="wl-dir">${escapeHtml(r.director)}</span>` : ''}
      </span>
      ${chip}
      <button class="wl-remove" title="Remove" aria-label="Remove">✕</button>
    </div>`;
}

// Bind newly-appended rows only (open → re-score; ✕ → remove then reload the list).
function bindWlRows(recs, reload) {
  recs.querySelectorAll('.rec:not([data-bound])').forEach((el) => {
    el.dataset.bound = '1';
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
      reload();
    });
  });
}

// "My watchlist": snapshot-driven, so the server filters + paginates (no TMDB); same paged list as
// ratings, with a ✕-remove per row.
function renderWatchlist(back) {
  return renderPagedList({
    endpoint: '/watchlist',
    back,
    rowHtml: wlRowHtml,
    bindRow: (recs) => bindWlRows(recs, () => renderWatchlist(back)),
    emptyMsg: 'Your watchlist is empty. Add titles from any movie page.',
  });
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
    // Enriched rows (poster + year + verdict chip) — same look as the ratings/watchlist lists.
    // Recommendation already carries posterUrl/year/verdict, so no extra fetch.
    recs.innerHTML = body.data.map(ratingRowHtml).join('');
    bindOpenRows(recs);
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
