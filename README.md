# CineMatch 🎬

> A Chrome extension that answers one question on any movie/show page: **should you watch it?**
> It shows a verdict on a 4-point scale — **Skip · Timepass · Go For It · Perfection** — from the
> TMDB rating, plus a personalised "for you" line based on your own taste.

The verdict (the meter) is **objective** — it comes straight from the TMDB rating band and is never
altered. Personalisation is a **separate** attention-grabbing line ("🔥 Peak you — exactly your
taste") derived from how the title's genres line up with the films you've rated highly.

---

## How it works

```
 movie page ──content.js──▶ popup ──GET /score?title=──▶ backend ──▶ TMDB (rating + genres)
 (Netflix, …)                                             │              │
                                                          ▼              ▼
                                              genre affinity        ScoreCache (Mongo)
                                              (your profile)              │
                                                          └──▶ Scorer ────┘
                                                                 │
                                          verdict + taste-match ◀┘  ──▶ gauge in popup
```

Your taste profile is loaded once via `POST /sync-profile` — from a local Playwright scraper of your
[Moctale](https://www.moctale.in) reviews, or from a plain JSON file (see [profiles](#supplying-a-taste-profile)).

## Repo layout

| Path | What |
|------|------|
| `extension/` | Chrome extension, vanilla JS, Manifest v3 (load unpacked). |
| `backend/` | Node + Express + TypeScript API. Layered: **route → controller → logic → service / model**. |
| `scraper/` | Local Playwright script — logs into Moctale (manual, once) and syncs your ratings. |
| `deploy/`, `docs/DEPLOY.md`, `.github/workflows/` | Nginx config + step-by-step deploy + CI/CD. |

### Backend architecture
- **route** — maps a path to a controller method (thin).
- **controller** — class; validates input with Zod, calls a logic class, returns an `ApiResponse<T>` with the right status. No business logic.
- **logic** — class implementing `ILogic<I,O>` with `execute()`. One per operation (`ScoreLogic`, `RecommendLogic`, `SyncProfileLogic`), plus the pure `Scorer` and shared `MovieLookup`.
- **service** — third-party API clients only (`TmdbService`). Not for DB.
- **model** — Mongoose model + static functions for all DB access (`Profile`, `ScoreCache`).

Everything is wired in one composition root (`src/app.ts`) and depends on interfaces, so it's easy to swap/mock.

## Scoring

| TMDB rating | Verdict |
|---|---|
| `0–4` | Skip |
| `4–6` | Timepass |
| `6–7.5` | Go For It |
| `7.5–10` | Perfection |

**Taste match** (separate from the verdict): each rated verdict maps to a weight (Skip 1 … Perfection 4).
Per-genre mean weight minus your overall mean gives a genre affinity. A title's genres averaged against
that affinity yield `strong` / `mild` / `mismatch` (or nothing). No profile → no taste line, verdict only.

---

## Quick start (local dev)

**Backend**
```bash
cd backend
npm install
cp .env.example .env      # fill TMDB tokens + MONGODB_URI + SYNC_TOKEN
npm run dev               # http://localhost:3000/health
npm test                  # vitest
```

**Extension**
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/`.
2. Open a movie page (or click the icon anywhere) → the popup shows the verdict, or a search box + mood picks.

**Scraper** (optional, needs Moctale account)
```bash
cd scraper
npm install
npx playwright install chromium
cp .env.example .env       # BACKEND_URL, SYNC_TOKEN (match backend), Moctale URLs
npm run scrape             # a browser opens — log in once, it does the rest
npm test                   # parse unit tests
```

## Environment variables

**backend/.env**

| Var | Purpose |
|---|---|
| `TMDB_API_KEY` | TMDB v3 key (fallback). |
| `TMDB_READ_ACCESS_TOKEN` | TMDB v4 read token — sent as Bearer on API calls. |
| `MONGODB_URI` | MongoDB Atlas connection string. |
| `PORT` | HTTP port (default 3000). |
| `SYNC_TOKEN` | Bearer secret guarding `POST /sync-profile`. |
| `BACKEND_URL` | Only for `npm run seed` (defaults to `http://localhost:$PORT`). |

**scraper/.env**

| Var | Purpose |
|---|---|
| `BACKEND_URL` | Where to POST the profile. |
| `SYNC_TOKEN` | Must equal the backend's. |
| `MOCTALE_PROFILE_URL` | Your Moctale reviews page. |
| `MOCTALE_WATCHLIST_URLS` | Comma-separated collection URLs. |

Real `.env` files are gitignored; commit only `.env.example`.

## Supplying a taste profile

Three ways, all hitting `POST /sync-profile` (Bearer `SYNC_TOKEN`):
1. **None** — the extension still works; you get objective verdicts, no taste line.
2. **Seed a JSON file** — edit `backend/profile.example.json` (records of `{title, type, year, verdict}`) and run `cd backend && npm run seed`.
3. **Moctale scraper** — `cd scraper && npm run scrape`.

### Moctale login (Cloudflare)
Moctale's login has a Cloudflare human check, so the scraper can't log in headlessly. It opens a **real
browser**; you log in once (username/phone + password + the check). The session is saved in
`scraper/.moctale-session/` and reused, so later runs scrape straight away. **No credentials are stored.**
If selectors ever return 0 rows: `npm run scrape -- --dump` saves the live HTML to tune them.

## API

| Method | Route | Notes |
|---|---|---|
| GET | `/health` | Liveness. |
| GET | `/score?title=&year=` | Verdict + taste match for a title. |
| GET | `/recommend?mood=&genre=&limit=` | Scored picks (grid/browse fallback). |
| POST | `/sync-profile` | Load ratings + watchlist. **Bearer `SYNC_TOKEN` required.** |

All responses use `{ success, data?, error? }`.

## Deploy

Full walk-through in **[docs/DEPLOY.md](docs/DEPLOY.md)** — MongoDB Atlas + AWS EC2 free tier + Nginx +
Let's Encrypt HTTPS at `https://api.adityadevhub.in`, with GitHub Actions auto-deploy on merge to `main`.
After deploying, set `DEFAULT_BACKEND` in `extension/popup.js` to your API URL.

## Fork it

CineMatch isn't tied to one account. Fork, set your own `.env`, and either seed your ratings as JSON or
adapt the scraper to your source — the backend and the profile API stay the same.

## Tech

Vanilla JS (MV3) · Node 20 · Express · TypeScript · Mongoose · Zod · Playwright · vitest.
