# CineMatch — project guide for Claude

Chrome extension that shows a **Skip / Timepass / Go For It / Perfection** verdict on any movie/show
page, plus a personalised taste-match line, trailer, where-to-watch, director/actor, awards, and a
personal watchlist. Backed by a layered TypeScript + Express API on MongoDB, reading TMDB (+ OMDb).

- **Prod:** `https://cinematch.adityadevhub.in` (EC2 + Nginx + Let's Encrypt).
- **Deploy:** push to `main` → GitHub Actions runs tests, then SSHes in and `git pull && npm ci && npm run build && pm2 reload`. Server: `~/cinematch`, pm2 app `cinematch-api`, SSH key `~/.ssh/cinematch_ci`, host `ec2-user@13.205.85.154`.
- **Single-tenant:** one deployment = one user; taste + watchlist live on the `default` profile. Forkers run their own backend/Mongo.

## Layout
- `extension/` — vanilla JS MV3 (no build). `content.js` detects the title per-site; `popup.js`/`popup.html` render.
- `backend/` — layered: **route → controller → logic → service / model**, wired in `src/app.ts`. Statics on Mongoose models own all DB access.
- `e2e/` — Playwright popup smoke test (`npm run test:popup`).
- `deploy/`, `.github/workflows/deploy.yml` — Nginx + CI/CD.

## Backend conventions
- `tsconfig.json` = editor + `npm run typecheck` (includes src+scripts+tests, no emit). `tsconfig.build.json` = `npm run build` (emits `dist/index.js`; **must stay `dist/index.js`** — pm2/CI expect it).
- Third-party clients are services (`TmdbService`, `OmdbService`); DB via model statics (`Profile`, `ScoreCache`). Extras (watch/trailer/credits/omdb) are cached in-memory via `TtlCache` and must **never break a score** (each wrapped in `.catch`).
- Public endpoints (`/score`, `/recommend`, `/watchlist`) are rate-limited (`rateLimit` middleware, 60/min/IP). `/sync-profile` needs `SYNC_TOKEN`.
- Env: `TMDB_*`, `MONGODB_URI`, `SYNC_TOKEN` required; `OMDB_API_KEY` optional (awards degrade to omitted).

## Taste match (how the "for you" line works)
Objective verdict = TMDB rating band, never moved by the profile. Taste match is a **separate** line:
- Each rated verdict → weight (Skip 1 … Perfection 4). Per-genre mean weight − overall mean = signed **affinity** (`syncProfile.logic.ts`). Relative, to cancel a cinephile's "rate everything high" bias.
- `Scorer` averages the title's genres' affinities → `strong` (≥0.5) / `mild` (≥0.12) / `mismatch` (≤−0.12) / none. Messages in `scorer.logic.ts`.
- Multi-genre films often average to neutral (no line) — expected. Distinctive genres (the user's are War/Music/History/Drama/Crime/Mystery) fire; Horror/Romance/Kids read mismatch.
- Others get it by seeding their own ratings: edit `backend/profile.example.json`, `npm run seed`.

## Working agreement (follow for every change)
- **Any new feature ships with tests** (vitest for backend logic/services; update `routes.test.ts` mocks).
- **Run the prod build locally** before pushing: `npm run typecheck && npm run build && npm test` (backend) + `npm run test:popup` (e2e).
- **Add/extend a Playwright smoke test when possible.** Some things (new routes) can only be verified after deploy — after merging, run a **prod smoke test** (curl the new endpoints + the e2e popup) since the route doesn't exist until CI deploys.
- Extension is vanilla JS — reload unpacked to test; `git push` does not update it.
