import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Profile } from '../src/models/profile.model.js';
import { ScoreCache } from '../src/models/scoreCache.model.js';
import type { ILlm, IOmdbService, ITmdbService, TmdbMovie } from '../src/types/index.js';

const SYNC_TOKEN = 'secret-token';

const inception: TmdbMovie = {
  tmdbId: 27205,
  mediaType: 'movie',
  title: 'Inception',
  year: 2010,
  rating: 8.4,
  genres: ['Action', 'Science Fiction'],
  posterUrl: 'https://img/inception.jpg',
  releaseDate: '2010-07-16',
  released: true,
};

// Fake TMDB client so routes never hit the network.
const tmdb: ITmdbService = {
  searchTitle: vi.fn(async () => inception),
  discover: vi.fn(async () => [inception]),
  watchProviders: vi.fn(async () => ({
    link: 'https://tmdb/watch',
    flatrate: [{ name: 'Netflix', logoUrl: 'https://img/nf.jpg' }],
    rent: [],
    buy: [],
  })),
  trailerUrl: vi.fn(async () => 'https://www.youtube.com/watch?v=YoHD9XEInc0'),
  credits: vi.fn(async () => ({ director: 'Christopher Nolan', leadActor: 'Leonardo DiCaprio' })),
};

const omdb: IOmdbService = {
  lookup: vi.fn(async () => ({ awards: 'Won 4 Oscars.', imdbRating: '8.8' })),
};

const app = createApp({ tmdb, omdb, syncToken: SYNC_TOKEN });

beforeEach(() => {
  // Spy on model statics so no real Mongo is needed.
  vi.spyOn(ScoreCache, 'get').mockResolvedValue(undefined);
  vi.spyOn(ScoreCache, 'put').mockResolvedValue(undefined);
  vi.spyOn(Profile, 'getRatedMovies').mockResolvedValue([]);
  vi.spyOn(Profile, 'findLanguagePriority').mockResolvedValue([]);
  vi.spyOn(Profile, 'upsertProfile').mockResolvedValue({} as never);
  vi.spyOn(Profile, 'isOnWatchlist').mockResolvedValue(false);
  vi.spyOn(Profile, 'getRating').mockResolvedValue(null);
  vi.spyOn(Profile, 'addRating').mockResolvedValue(1);
});
afterEach(() => vi.restoreAllMocks());

describe('GET /score', () => {
  it('returns a scored verdict envelope', async () => {
    const res = await request(app).get('/score').query({ title: 'Inception' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      title: 'Inception',
      type: 'Movie',
      verdict: 'Perfection',
      tmdbRating: 8.4,
      trailerUrl: 'https://www.youtube.com/watch?v=YoHD9XEInc0',
      watch: { flatrate: [{ name: 'Netflix' }] },
      director: 'Christopher Nolan',
      leadActor: 'Leonardo DiCaprio',
      awards: 'Won 4 Oscars.',
      imdbRating: '8.8',
      released: true,
    });
  });

  it('400s when title is missing', async () => {
    const res = await request(app).get('/score');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s when TMDB has no match', async () => {
    (tmdb.searchTitle as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await request(app).get('/score').query({ title: 'Nonexistent' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MOVIE_NOT_FOUND');
  });
});

describe('GET /recommend', () => {
  it('returns recommendations for a mood', async () => {
    const res = await request(app).get('/recommend').query({ mood: 'intense' });
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ title: 'Inception', verdict: 'Perfection' });
  });
});

describe('POST /rate + GET /ratings', () => {
  it('persists a rating', async () => {
    const res = await request(app)
      .post('/rate')
      .send({ title: 'Inception', type: 'Movie', year: 2010, verdict: 'Perfection' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ rated: true });
    expect(Profile.addRating).toHaveBeenCalledWith('default', {
      title: 'Inception',
      type: 'Movie',
      year: 2010,
      verdict: 'Perfection',
      posterUrl: undefined,
    });
  });

  it('400s on an invalid verdict', async () => {
    const res = await request(app).post('/rate').send({ title: 'Inception', verdict: 'Amazing' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists the raw ratings newest-first', async () => {
    (Profile.getRatedMovies as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { title: 'Inception', type: 'Movie', year: 2010, verdict: 'Perfection' },
    ]);
    const res = await request(app).get('/ratings');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ title: 'Inception', verdict: 'Perfection' });
  });
});

describe('POST /regenerate-taste (only when LLM configured)', () => {
  const tastePath = join(tmpdir(), `cinematch-taste-test-${process.pid}.md`);
  const fakeLlm: ILlm = { generate: vi.fn(async () => ({ text: 'Fresh taste prose.', model: 'gemini', fallback: false })) };
  const llmApp = createApp({
    tmdb,
    omdb,
    syncToken: SYNC_TOKEN,
    llm: fakeLlm,
    tasteRef: { text: 'old prose', version: 0 },
    tasteProfilePath: tastePath,
  });
  afterEach(() => {
    try {
      rmSync(tastePath);
    } catch {
      /* file may not exist */
    }
  });

  it('regenerates from the current ratings and writes the file', async () => {
    (Profile.getRatedMovies as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: 'Inception', type: 'Movie', year: 2010, verdict: 'Perfection' },
    ]);
    vi.spyOn(Profile, 'bumpTasteVersion').mockResolvedValue(1);
    vi.spyOn(Profile, 'resetRegenCounter').mockResolvedValue(undefined);

    const res = await request(llmApp).post('/regenerate-taste');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ regenerated: true });
    expect(readFileSync(tastePath, 'utf8')).toContain('Fresh taste prose');
  });

  it('404s when no LLM is configured (route not mounted)', async () => {
    const res = await request(app).post('/regenerate-taste');
    expect(res.status).toBe(404);
  });
});

describe('POST /sync-profile', () => {
  const body = {
    ratedMovies: [{ title: 'Inception', type: 'Movie', year: 2010, verdict: 'Perfection' }],
    watchlist: [],
  };

  it('rejects without a valid token', async () => {
    const res = await request(app).post('/sync-profile').send(body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('accepts a valid token and persists', async () => {
    const res = await request(app)
      .post('/sync-profile')
      .set('Authorization', `Bearer ${SYNC_TOKEN}`)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.ratedCount).toBe(1);
    expect(Profile.upsertProfile).toHaveBeenCalledOnce();
  });
});
