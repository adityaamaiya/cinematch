# CineMatch (moctale-meter)

> Chrome extension that tells you whether a movie/show is worth your time — a verdict on a
> 4-point scale (**Skip / Timepass / Go For It / Perfection**) — personalised to your taste.

This is a stub. The full README (architecture, setup, env reference, deploy guides, fork
guide) is written in **Phase 7**. See `docs`/the build plan for the roadmap.

## Packages
- `extension/` — Chrome extension (vanilla JS, Manifest v3).
- `backend/` — Node + Express + TypeScript API (layered: route → controller → logic → service/model).
- `scraper/` — Playwright script (runs locally) that syncs your Moctale ratings to the backend.

## Quick start (dev)
```bash
cd backend && npm install && cp .env.example .env   # fill in TMDB token + Mongo URI
npm run dev                                          # http://localhost:3000/health
```
