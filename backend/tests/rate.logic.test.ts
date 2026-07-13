import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLogic } from '../src/logic/rate.logic.js';
import { GenerateTasteLogic } from '../src/logic/generateTaste.logic.js';
import { Profile } from '../src/models/profile.model.js';
import { Logger } from '../src/lib/logger.js';

const silent = new Logger('test');
vi.spyOn(silent, 'error').mockImplementation(() => {});

// A GenerateTasteLogic stand-in whose execute we can watch.
function fakeGen(execute = vi.fn().mockResolvedValue(true)): GenerateTasteLogic {
  return { execute } as unknown as GenerateTasteLogic;
}

const movie = { title: 'Inception', type: 'Movie', year: 2010, verdict: 'Perfection' } as const;

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Profile, 'removeFromWatchlist').mockResolvedValue(undefined);
});

describe('RateLogic', () => {
  it('fires a regen when the since-regen count reaches the threshold', async () => {
    vi.spyOn(Profile, 'addRating').mockResolvedValue(10); // 10th since last regen
    const execute = vi.fn().mockResolvedValue(true);
    await new RateLogic(10, silent, fakeGen(execute)).execute({ userKey: 'default', ...movie });
    // fire-and-forget — let the microtask run
    await Promise.resolve();
    expect(execute).toHaveBeenCalledWith({ userKey: 'default' });
  });

  it('does NOT regen before the threshold', async () => {
    vi.spyOn(Profile, 'addRating').mockResolvedValue(9);
    const execute = vi.fn().mockResolvedValue(true);
    const res = await new RateLogic(10, silent, fakeGen(execute)).execute({ userKey: 'default', ...movie });
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    expect(res).toEqual({ rated: true });
  });

  it('never lets a regen error fail the rating', async () => {
    vi.spyOn(Profile, 'addRating').mockResolvedValue(10);
    const execute = vi.fn().mockRejectedValue(new Error('regen boom'));
    const res = await new RateLogic(10, silent, fakeGen(execute)).execute({ userKey: 'default', ...movie });
    await Promise.resolve();
    expect(res).toEqual({ rated: true });
  });

  it('just accumulates when no regen is configured (no LLM)', async () => {
    vi.spyOn(Profile, 'addRating').mockResolvedValue(50);
    const res = await new RateLogic(10, silent).execute({ userKey: 'default', ...movie });
    expect(res).toEqual({ rated: true });
  });

  it('auto-removes the rated title from the watchlist', async () => {
    vi.spyOn(Profile, 'addRating').mockResolvedValue(1);
    await new RateLogic(10, silent).execute({ userKey: 'default', ...movie });
    expect(Profile.removeFromWatchlist).toHaveBeenCalledWith('default', 'Inception', 2010);
  });
});
