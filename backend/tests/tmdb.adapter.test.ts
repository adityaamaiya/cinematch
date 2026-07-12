import { describe, it, expect } from 'vitest';
import { TmdbAdapter } from '../src/adapters/tmdb.adapter.js';

const adapter = new TmdbAdapter();
const genres = new Map<number, string>([
  [28, 'Action'],
  [878, 'Science Fiction'],
]);

describe('TmdbAdapter.adapt', () => {
  it('maps a search item + genre map to a TmdbMovie', () => {
    expect(
      adapter.adapt({
        item: {
          id: 27205,
          media_type: 'movie',
          title: 'Inception',
          release_date: '2010-07-16',
          vote_average: 8.4,
          vote_count: 36000,
          genre_ids: [28, 878, 99],
          original_language: 'en',
          poster_path: '/p.jpg',
        },
        genres,
      }),
    ).toEqual({
      tmdbId: 27205,
      mediaType: 'movie',
      title: 'Inception',
      year: 2010,
      rating: 8.4,
      voteCount: 36000,
      genres: ['Action', 'Science Fiction'], // id 99 unknown → dropped
      language: 'en',
      posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
      releaseDate: '2010-07-16',
      released: true,
    });
  });

  it('flags a future release_date as not released', () => {
    const m = adapter.adapt({ item: { id: 1, release_date: '2999-01-01' }, genres });
    expect(m.released).toBe(false);
  });
});

describe('TmdbAdapter helpers', () => {
  it('credits: director from crew + top-billed actor by order', () => {
    expect(
      adapter.credits({
        crew: [{ job: 'Writer', name: 'W' }, { job: 'Director', name: 'Nolan' }],
        cast: [{ name: 'Second', order: 1 }, { name: 'Lead', order: 0 }],
      }),
    ).toEqual({ director: 'Nolan', leadActor: 'Lead' });
  });

  it('watch: maps a region, null when empty', () => {
    expect(adapter.watch({ link: 'x', flatrate: [{ provider_name: 'Netflix', logo_path: '/n.jpg' }] })).toEqual({
      link: 'x',
      flatrate: [{ name: 'Netflix', logoUrl: 'https://image.tmdb.org/t/p/w92/n.jpg' }],
      rent: [],
      buy: [],
    });
    expect(adapter.watch({ flatrate: [], rent: [], buy: [] })).toBeNull();
    expect(adapter.watch(undefined)).toBeNull();
  });

  it('trailer: prefers an official YouTube trailer', () => {
    expect(
      adapter.trailer([
        { site: 'YouTube', type: 'Teaser', key: 't' },
        { site: 'YouTube', type: 'Trailer', key: 'off', official: true },
      ]),
    ).toBe('https://www.youtube.com/watch?v=off');
    expect(adapter.trailer([{ site: 'Vimeo', key: 'x' }])).toBeUndefined();
  });
});
