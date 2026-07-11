import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Profile } from '../src/models/profile.model.js';
import { ScoreCache } from '../src/models/scoreCache.model.js';
import type { ITmdbService, TmdbMovie } from '../src/types/index.js';

const SYNC_TOKEN = 'secret-token';

const inception: TmdbMovie = {
  tmdbId: 27205,
  title: 'Inception',
  year: 2010,
  rating: 8.4,
  genres: ['Action', 'Science Fiction'],
  posterUrl: 'https://img/inception.jpg',
};

// Fake TMDB client so routes never hit the network.
const tmdb: ITmdbService = {
  searchTitle: vi.fn(async () => inception),
  discover: vi.fn(async () => [inception]),
};

const app = createApp({ tmdb, syncToken: SYNC_TOKEN });

beforeEach(() => {
  // Spy on model statics so no real Mongo is needed.
  vi.spyOn(ScoreCache, 'get').mockResolvedValue(undefined);
  vi.spyOn(ScoreCache, 'put').mockResolvedValue(undefined);
  vi.spyOn(Profile, 'findAffinity').mockResolvedValue({});
  vi.spyOn(Profile, 'upsertProfile').mockResolvedValue({} as never);
});
afterEach(() => vi.restoreAllMocks());

describe('GET /score', () => {
  it('returns a scored verdict envelope', async () => {
    const res = await request(app).get('/score').query({ title: 'Inception' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ title: 'Inception', verdict: 'Perfection', tmdbRating: 8.4 });
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
