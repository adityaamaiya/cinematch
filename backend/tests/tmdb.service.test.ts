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
      mediaType: 'movie',
      title: 'Inception',
      year: 2010,
      rating: 8.4,
      genres: ['Action', 'Thriller'],
      posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
      releaseDate: '2010-07-16',
      released: true,
    });
  });

  it('marks a future release_date as not released', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ...GENRE_ROUTES,
        '/search/multi': {
          body: {
            results: [
              { id: 9, media_type: 'movie', title: 'Future Film', release_date: '2999-01-01', genre_ids: [28] },
            ],
          },
        },
      }),
    );
    const movie = await service.searchTitle('Future Film');
    expect(movie?.released).toBe(false);
    expect(movie?.releaseDate).toBe('2999-01-01');
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

  it('prefers a preferred-language title over a more popular other-language one (same name)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ...GENRE_ROUTES,
        '/search/multi': {
          body: {
            results: [
              { id: 1, media_type: 'movie', title: 'Drishyam', popularity: 999, original_language: 'en', genre_ids: [28] },
              { id: 2, media_type: 'movie', title: 'Drishyam', popularity: 5, original_language: 'hi', genre_ids: [28] },
            ],
          },
        },
      }),
    );
    const movie = await service.searchTitle('Drishyam', undefined, ['hi', 'en']);
    expect(movie?.tmdbId).toBe(2);
    expect(movie?.language).toBe('hi');
  });

  it('a matching year still beats language preference', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ...GENRE_ROUTES,
        '/search/multi': {
          body: {
            results: [
              { id: 1, media_type: 'movie', title: 'Drishyam', release_date: '2013-12-13', original_language: 'ta', popularity: 5, genre_ids: [28] },
              { id: 2, media_type: 'movie', title: 'Drishyam', release_date: '2015-07-31', original_language: 'hi', popularity: 5, genre_ids: [28] },
            ],
          },
        },
      }),
    );
    // 'hi' is preferred but the page year is 2013 → the year match (+30) wins over language (+18).
    const movie = await service.searchTitle('Drishyam', 2013, ['hi']);
    expect(movie?.tmdbId).toBe(1);
  });

  it('returns null when no candidate title matches the query (confidence gate)', async () => {
    // A non-title lookup (e.g. a random page <h1>) — TMDB returns an unrelated film; we reject it.
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ...GENRE_ROUTES,
        '/search/multi': {
          body: { results: [{ id: 1, media_type: 'movie', title: 'Pasta', popularity: 999, genre_ids: [28] }] },
        },
      }),
    );
    expect(await service.searchTitle('How To Cook Dinner Tonight')).toBeNull();
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

describe('TmdbService.watchProviders', () => {
  it('maps the requested country to flatrate/rent/buy with logo URLs', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/movie/27205/watch/providers': {
          body: {
            results: {
              IN: {
                link: 'https://www.themoviedb.org/movie/27205/watch?locale=IN',
                flatrate: [{ provider_name: 'Netflix', logo_path: '/nf.jpg' }],
                rent: [{ provider_name: 'Apple TV', logo_path: null }],
              },
            },
          },
        },
      }),
    );

    const watch = await service.watchProviders(27205, 'movie', 'IN');
    expect(watch).toEqual({
      link: 'https://www.themoviedb.org/movie/27205/watch?locale=IN',
      flatrate: [{ name: 'Netflix', logoUrl: 'https://image.tmdb.org/t/p/w92/nf.jpg' }],
      rent: [{ name: 'Apple TV', logoUrl: undefined }],
      buy: [],
    });
  });

  it('returns null when the country has no availability', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/movie/1/watch/providers': { body: { results: { US: {} } } } }));
    expect(await service.watchProviders(1, 'movie', 'IN')).toBeNull();
  });
});

describe('TmdbService.credits', () => {
  it('extracts the director and top-billed actor', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/movie/27205/credits': {
          body: {
            crew: [
              { job: 'Writer', name: 'Someone' },
              { job: 'Director', name: 'Christopher Nolan' },
            ],
            cast: [
              { name: 'Joseph Gordon-Levitt', order: 1 },
              { name: 'Leonardo DiCaprio', order: 0 },
            ],
          },
        },
      }),
    );
    expect(await service.credits(27205, 'movie')).toEqual({
      director: 'Christopher Nolan',
      leadActor: 'Leonardo DiCaprio',
    });
  });
});

describe('TmdbService.trailerUrl', () => {
  it('prefers an official YouTube trailer', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/movie/27205/videos': {
          body: {
            results: [
              { site: 'YouTube', type: 'Teaser', key: 'teaser1' },
              { site: 'YouTube', type: 'Trailer', key: 'off1', official: true },
            ],
          },
        },
      }),
    );
    expect(await service.trailerUrl(27205, 'movie')).toBe('https://www.youtube.com/watch?v=off1');
  });

  it('returns undefined when TMDB has no YouTube video', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/movie/1/videos': { body: { results: [{ site: 'Vimeo', key: 'x' }] } } }));
    expect(await service.trailerUrl(1, 'movie')).toBeUndefined();
  });
});
