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

  it('falls through to the next model on a transient 429/503', async () => {
    const chain = new GeminiService('k', 'model-a,model-b', new Logger('test'));
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return (url.includes('model-a')
        ? { ok: false, status: 429, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) }) as Response;
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    expect(await chain.generate('hi')).toBe('ok');
    expect(urls[0]).toContain('model-a');
    expect(urls[1]).toContain('model-b');
  });

  it('throws only when every model in the chain is exhausted', async () => {
    const chain = new GeminiService('k', 'model-a,model-b', new Logger('test'));
    vi.stubGlobal('fetch', mockFetch(429, {}));
    await expect(chain.generate('hi')).rejects.toThrow(/Gemini request failed/);
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
