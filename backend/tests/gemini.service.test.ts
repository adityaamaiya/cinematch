import { describe, it, expect, vi, afterEach } from 'vitest';
import { GeminiService } from '../src/services/gemini.service.js';
import { Logger } from '../src/lib/logger.js';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response);
}
const svc = new GeminiService('test-key', 'gemini-flash-latest', new Logger('test'));
afterEach(() => vi.unstubAllGlobals());

describe('GeminiService.generate', () => {
  it('joins the candidate parts into text', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { candidates: [{ content: { parts: [{ text: 'he' }, { text: 'llo' }] } }] }));
    expect(await svc.generate('hi')).toBe('hello');
  });

  it('throws on a non-retryable upstream failure', async () => {
    vi.stubGlobal('fetch', mockFetch(500, {}));
    await expect(svc.generate('hi')).rejects.toThrow(/Gemini request failed/);
  });

  it('retries once on a transient 429/503', async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchMock = vi.fn(async () =>
      (++call === 1
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const p = svc.generate('hi');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws when the model returns no text', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { candidates: [{ content: {} }] }));
    await expect(svc.generate('hi')).rejects.toThrow(/empty/);
  });

  it('requests JSON output when asked', async () => {
    const fetchMock = mockFetch(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] });
    vi.stubGlobal('fetch', fetchMock);
    await svc.generate('hi', true);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('includes the response schema when given', async () => {
    const fetchMock = mockFetch(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] });
    vi.stubGlobal('fetch', fetchMock);
    await svc.generate('hi', true, { type: 'OBJECT' });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.generationConfig.responseSchema).toEqual({ type: 'OBJECT' });
  });
});
