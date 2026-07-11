import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TmdbService } from '../src/services/tmdb.service.js';
import { Logger } from '../src/lib/logger.js';

const BASE = 'https://api.themoviedb.org/3';

// Route a mocked fetch by URL path → JSON body. ok:false when `status` provided.
function mockFetch(routes: Record<string, { body?: unknown; status?: number }>) {
  return vi.fn(async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    const match = Object.keys(routes).find((path) => url.includes(path));
    const route = match ? routes[match] : { status: 404 };
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body ?? {},
    } as Response;
  });
}

const GENRE_ROUTES = {
  '/genre/movie/list': { body: { genres: [{ id: 28, name: 'Action' }, { id: 53, name: 'Thriller' }] } },
  '/genre/tv/list': { body: { genres: [{ id: 18, name: 'Drama' }] } },
};

let service: TmdbService;

beforeEach(() => {
  service = new TmdbService(BASE, 'test-token', new Logger('test'));
});
afterEach(() => vi.unstubAllGlobals());

describe('TmdbService.searchTitle', () => {
  it('maps genre ids to names and normalises the best match', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ...GENRE_ROUTES,
        '/search/multi': {
          body: {
            results: [
              {
                id: 27205,
                media_type: 'movie',
                title: 'Inception',
                release_date: '2010-07-16',
                vote_average: 8.4,
                genre_ids: [28, 53],
                poster_path: '/poster.jpg',
              },
            ],
          },
        },
      }),
    );

    const movie = await service.searchTitle('Inception', 2010);
    expect(movie).toEqual({
      tmdbId: 27205,
      title: 'Inception',
      year: 2010,
      rating: 8.4,
      genres: ['Action', 'Thriller'],
      posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    });
  });

  it('prefers an exact title match over a more popular partial match', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ...GENRE_ROUTES,
        '/search/multi': {
          body: {
            results: [
              { id: 1, media_type: 'movie', title: 'The Batman Returns Again', popularity: 999, genre_ids: [28] },
              { id: 2, media_type: 'movie', title: 'Batman', popularity: 10, genre_ids: [28] },
            ],
          },
        },
      }),
    );

    const movie = await service.searchTitle('Batman');
    expect(movie?.tmdbId).toBe(2);
  });

  it('returns null when there are no movie/tv results', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ ...GENRE_ROUTES, '/search/multi': { body: { results: [{ media_type: 'person', id: 5 }] } } }),
    );
    expect(await service.searchTitle('Nobody')).toBeNull();
  });

  it('throws on an upstream failure', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/search/multi': { status: 401 } }));
    await expect(service.searchTitle('X')).rejects.toThrow(/TMDB request failed/);
  });
});

describe('TmdbService.discover', () => {
  it('returns up to `limit` normalised movies', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ...GENRE_ROUTES,
        '/discover/movie': {
          body: {
            results: [
              { id: 1, title: 'A', vote_average: 9, genre_ids: [28] },
              { id: 2, title: 'B', vote_average: 8, genre_ids: [53] },
              { id: 3, title: 'C', vote_average: 7, genre_ids: [28] },
            ],
          },
        },
      }),
    );

    const movies = await service.discover([28], 2);
    expect(movies.map((m) => m.title)).toEqual(['A', 'B']);
    expect(movies[0].genres).toEqual(['Action']);
  });
});
