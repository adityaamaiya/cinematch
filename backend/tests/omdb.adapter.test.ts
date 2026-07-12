import { describe, it, expect } from 'vitest';
import { OmdbAdapter } from '../src/adapters/omdb.adapter.js';

const adapter = new OmdbAdapter();

describe('OmdbAdapter', () => {
  it('maps awards, imdb rating/votes, Rotten Tomatoes + metascore', () => {
    expect(
      adapter.adapt({
        Response: 'True',
        Awards: 'Won 4 Oscars.',
        imdbRating: '8.8',
        imdbVotes: '2,547,891',
        Metascore: '74',
        Ratings: [
          { Source: 'Internet Movie Database', Value: '8.8/10' },
          { Source: 'Rotten Tomatoes', Value: '87%' },
          { Source: 'Metacritic', Value: '74/100' },
        ],
      }),
    ).toEqual({
      awards: 'Won 4 Oscars.',
      imdbRating: '8.8',
      imdbVotes: '2,547,891',
      rottenTomatoes: '87%',
      metascore: '74',
    });
  });

  it('drops "N/A" fields', () => {
    expect(adapter.adapt({ Response: 'True', Awards: 'N/A', imdbRating: '7.1' })).toEqual({
      awards: undefined,
      imdbRating: '7.1',
      imdbVotes: undefined,
      rottenTomatoes: undefined,
      metascore: undefined,
    });
  });

  it('returns null on a miss or an all-empty response', () => {
    expect(adapter.adapt({ Response: 'False' })).toBeNull();
    expect(adapter.adapt({ Response: 'True' })).toBeNull();
  });
});
