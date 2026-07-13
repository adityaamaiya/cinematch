import { describe, it, expect, vi, afterEach } from 'vitest';
import { WatchlistLogic } from '../src/logic/watchlist.logic.js';
import { Profile } from '../src/models/profile.model.js';
import type { MovieLookup } from '../src/logic/movieLookup.js';
import type { ITmdbService, TmdbMovie, WatchlistMovie } from '../src/types/index.js';

const movie: TmdbMovie = {
  tmdbId: 1, mediaType: 'movie', title: 'X', rating: 8, genres: [], released: true, posterUrl: 'p',
};
// Minimal fakes — enrichment isn't under test here, pagination math is.
const lookup = { execute: vi.fn(async () => movie) } as unknown as MovieLookup;
const tmdb = { credits: vi.fn(async () => ({})) } as unknown as ITmdbService;

const make = (n: number): WatchlistMovie[] =>
  Array.from({ length: n }, (_, i) => ({ title: `T${i}`, type: 'Movie', collectionId: 'manual' }));

// Snapshot entries (have a stored verdict/poster) → rendered with no TMDB.
const snap = (n: number, verdict: WatchlistMovie['verdict'] = 'Go For It'): WatchlistMovie[] =>
  Array.from({ length: n }, (_, i) => ({
    title: `S${i}`, type: 'Movie', collectionId: 'manual',
    verdict, tmdbRating: 7, posterUrl: 'p', releaseDate: '2020-01-01',
  }));

afterEach(() => vi.restoreAllMocks());

describe('WatchlistLogic pagination', () => {
  it('returns a page and reports hasMore', async () => {
    vi.spyOn(Profile, 'getWatchlist').mockResolvedValue(make(30));
    const res = await new WatchlistLogic(lookup, tmdb).execute({ userKey: 'default', page: 0, limit: 12 });
    expect(res.items).toHaveLength(12);
    expect(res.total).toBe(30);
    expect(res.hasMore).toBe(true);
  });

  it('last page has hasMore=false', async () => {
    vi.spyOn(Profile, 'getWatchlist').mockResolvedValue(make(30));
    const res = await new WatchlistLogic(lookup, tmdb).execute({ userKey: 'default', page: 2, limit: 12 });
    expect(res.items).toHaveLength(6); // 30 - 24
    expect(res.hasMore).toBe(false);
  });

  it('only enriches legacy (snapshot-less) entries on the requested page', async () => {
    vi.spyOn(Profile, 'getWatchlist').mockResolvedValue(make(100));
    await new WatchlistLogic(lookup, tmdb).execute({ userKey: 'default', page: 0, limit: 12 });
    expect((lookup.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(12); // not 100
  });
});

describe('WatchlistLogic snapshot + filter', () => {
  it('renders snapshot entries with NO TMDB lookup', async () => {
    vi.spyOn(Profile, 'getWatchlist').mockResolvedValue(snap(3));
    const res = await new WatchlistLogic(lookup, tmdb).execute({ userKey: 'default' });
    expect(res.items).toHaveLength(3);
    expect(res.items[0].posterUrl).toBe('p');
    expect(lookup.execute).not.toHaveBeenCalled();
  });

  it('filters by verdict (stored snapshot)', async () => {
    vi.spyOn(Profile, 'getWatchlist').mockResolvedValue([...snap(2, 'Skip'), ...snap(3, 'Perfection')]);
    const res = await new WatchlistLogic(lookup, tmdb).execute({ userKey: 'default', verdict: 'Skip' });
    expect(res.items).toHaveLength(2);
    expect(res.items.every((i) => i.verdict === 'Skip')).toBe(true);
  });

  it('filters by q (title substring)', async () => {
    vi.spyOn(Profile, 'getWatchlist').mockResolvedValue(snap(5));
    const res = await new WatchlistLogic(lookup, tmdb).execute({ userKey: 'default', q: 'S3' });
    expect(res.items.map((i) => i.title)).toEqual(['S3']);
  });
});
