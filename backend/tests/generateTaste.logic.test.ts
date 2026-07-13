import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { GenerateTasteLogic } from '../src/logic/generateTaste.logic.js';
import { Profile } from '../src/models/profile.model.js';
import { Logger } from '../src/lib/logger.js';
import type { ILlm, TasteProfileRef } from '../src/types/index.js';

const path = join(tmpdir(), `cinematch-gentaste-${process.pid}.md`);
const silent = new Logger('test');
// Logger writes to stderr; keep the test output clean.
vi.spyOn(silent, 'info').mockImplementation(() => {});
vi.spyOn(silent, 'warn').mockImplementation(() => {});
vi.spyOn(silent, 'error').mockImplementation(() => {});

const fakeLlm = (text: string, spy = vi.fn()): ILlm => ({
  generate: spy.mockResolvedValue({ text, model: 'gemini', fallback: false }),
});

beforeEach(() => {
  vi.spyOn(Profile, 'getRatedMovies').mockResolvedValue([
    { title: 'Memories of Murder', type: 'Movie', year: 2003, verdict: 'Perfection' },
    { title: 'Fast X', type: 'Movie', year: 2023, verdict: 'Skip' },
  ]);
  vi.spyOn(Profile, 'bumpTasteVersion').mockResolvedValue(3);
  vi.spyOn(Profile, 'resetRegenCounter').mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(path);
  } catch {
    /* ignore */
  }
});

describe('GenerateTasteLogic', () => {
  it('regenerates: builds a prompt from ratings + exemplar, writes the file, bumps version, resets counter', async () => {
    const genSpy = vi.fn();
    const ref: TasteProfileRef = { text: 'EXEMPLAR PROSE', version: 2 };
    const ok = await new GenerateTasteLogic(fakeLlm('New profile prose.', genSpy), ref, path, silent).execute({
      userKey: 'default',
    });

    expect(ok).toBe(true);
    const prompt = genSpy.mock.calls[0][0] as string;
    expect(prompt).toContain('Memories of Murder');
    expect(prompt).toContain('Skip');
    expect(prompt).toContain('EXEMPLAR PROSE'); // current profile fed back as the style template
    const budget = genSpy.mock.calls[0][3] as number;
    expect(budget).toBeGreaterThanOrEqual(8192); // long-output budget, not the 2048 default

    expect(readFileSync(path, 'utf8')).toContain('New profile prose.');
    expect(ref.text).toBe('New profile prose.');
    expect(ref.version).toBe(3);
    expect(Profile.resetRegenCounter).toHaveBeenCalledWith('default');
  });

  it('is a no-op when there are no ratings', async () => {
    (Profile.getRatedMovies as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const ok = await new GenerateTasteLogic(fakeLlm('x'), { text: '', version: 0 }, path, silent).execute({
      userKey: 'default',
    });
    expect(ok).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it('leaves the profile + version intact when the LLM fails', async () => {
    const ref: TasteProfileRef = { text: 'OLD', version: 5 };
    const llm: ILlm = { generate: vi.fn(async () => { throw new Error('boom'); }) };
    const ok = await new GenerateTasteLogic(llm, ref, path, silent).execute({ userKey: 'default' });
    expect(ok).toBe(false);
    expect(ref.text).toBe('OLD');
    expect(ref.version).toBe(5);
    expect(Profile.bumpTasteVersion).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(false);
  });
});
