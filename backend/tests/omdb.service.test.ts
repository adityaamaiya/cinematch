import { describe, it, expect, vi, afterEach } from 'vitest';
import { OmdbService } from '../src/services/omdb.service.js';
import { Logger } from '../src/lib/logger.js';

const logger = new Logger('test');

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response);
}

afterEach(() => vi.unstubAllGlobals());

describe('OmdbService', () => {
  it('returns awards + imdbRating on a hit', async () => {
    vi.stubGlobal('fetch', mockFetch({ Response: 'True', Awards: 'Won 4 Oscars.', imdbRating: '8.8' }));
    const svc = new OmdbService('key', logger);
    expect(await svc.lookup('Inception', 2010)).toEqual({ awards: 'Won 4 Oscars.', imdbRating: '8.8' });
  });

  it('is a no-op (no fetch) when the api key is empty', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const svc = new OmdbService('', logger);
    expect(await svc.lookup('Inception')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when OMDb reports no match', async () => {
    vi.stubGlobal('fetch', mockFetch({ Response: 'False', Error: 'Movie not found!' }));
    const svc = new OmdbService('key', logger);
    expect(await svc.lookup('Nonexistent')).toBeNull();
  });

  it('drops "N/A" fields', async () => {
    vi.stubGlobal('fetch', mockFetch({ Response: 'True', Awards: 'N/A', imdbRating: '7.1' }));
    const svc = new OmdbService('key', logger);
    expect(await svc.lookup('Some Film')).toEqual({ awards: undefined, imdbRating: '7.1' });
  });
});
