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
- Layers: **route → controller → logic → service/adapter → model**. Each `logic/` file is one `ILogic` class (`execute()` is the only entry; everything else a private method). Services (`TmdbService`, `OmdbService`) are HTTP-only; **adapters** (`IAdapter<Raw,Out>`, `adapt()`) own response→domain shaping in `adapters/`. Shared pure helpers go in `lib/` (e.g. `lib/affinity.ts`), not inside a class file. DB via model statics (`Profile`, `ScoreCache`).
- Extras (watch/trailer/credits/omdb) are cached in-memory via `TtlCache` and must **never break a score** (each wrapped in `.catch`).
- Public endpoints (`/score`, `/recommend`, `/watchlist`) are rate-limited (`rateLimit` middleware, 60/min/IP). `/sync-profile` needs `SYNC_TOKEN`.
- Env: `TMDB_*`, `MONGODB_URI`, `SYNC_TOKEN` required; `OMDB_API_KEY` optional (awards degrade to omitted).

## Taste match (how the "for you" line works)
Objective verdict = TMDB rating band (`verdictBand` in `lib/affinity.ts`), never moved by the profile.
Taste match is a **separate**, LLM-only line:
- `LlmTaste` (`tasteLlm.logic.ts`) asks Gemini to reason over `backend/taste-profile.md` (gitignored, per-deployment prose summary of the user's ratings) → `strong`/`mild`/`mismatch`/none + a "% match — why" message. Constrained JSON decoding; cached per title (6h) in `ScoreLogic`.
- Reliability = a model fallback chain in `LlmChain` (`services/llmChain.ts`): every `GEMINI_MODEL` (comma-list) in order, then an optional **Groq** provider (`GROQ_API_KEY`, `GroqService`) when all Gemini models 429. Each provider is an `ILlmProvider` (`request(model,…)`); the chain reports which model answered + a `fallback` flag. When a non-primary model answers, `LlmTaste` sets `TasteMatch.via` and the popup shows a small `via <model>` tag. All LLM providers gone/exhausted → **no taste line** (no statistical fallback — affinity engine removed).
- `/recommend` is LLM-based too (`LlmRecommend` → suggestions filtered against watched + resolved on TMDB); no key → thin mood→genre→`tmdb.discover` fallback (`moods.ts`).
- Forkers: write your own `backend/taste-profile.md` (see `taste-profile.example.md`), set `GEMINI_API_KEY`/`GEMINI_MODEL`, `npm run seed` your ratings (drives watchlist + language priority).

## Working agreement (follow for every change)
- **Any new feature ships with tests** (vitest for backend logic/services; update `routes.test.ts` mocks).
- **Run the prod build locally** before pushing: `npm run typecheck && npm run build && npm test` (backend) + `npm run test:popup` (e2e).
- **Add/extend a Playwright smoke test when possible.** Some things (new routes) can only be verified after deploy — after merging, run a **prod smoke test** (curl the new endpoints + the e2e popup) since the route doesn't exist until CI deploys.
- Extension is vanilla JS — reload unpacked to test; `git push` does not update it.
