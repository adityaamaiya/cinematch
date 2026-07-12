import { describe, it, expect, vi, afterEach } from 'vitest';
import { GroqService } from '../src/services/groq.service.js';
import { Logger } from '../src/lib/logger.js';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response);
}
const svc = new GroqService('test-key', 'llama-3.3-70b-versatile', new Logger('test'));
afterEach(() => vi.unstubAllGlobals());

describe('GroqService.request', () => {
  it('returns the assistant message content', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { choices: [{ message: { content: '{"ok":true}' } }] }));
    expect(await svc.request('llama-3.3-70b-versatile', 'hi')).toBe('{"ok":true}');
  });

  it('defaults to llama-3.3-70b-versatile when no model given', () => {
    expect(new GroqService('k', '', new Logger('test')).models).toEqual(['llama-3.3-70b-versatile']);
  });

  it('asks for json_object mode when json=true', async () => {
    const fetchMock = mockFetch(200, { choices: [{ message: { content: '{}' } }] });
    vi.stubGlobal('fetch', fetchMock);
    await svc.request('llama-3.3-70b-versatile', 'give me json', true);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('throws with the status in the message on failure', async () => {
    vi.stubGlobal('fetch', mockFetch(429, {}));
    await expect(svc.request('llama-3.3-70b-versatile', 'hi')).rejects.toThrow(/Groq request failed \(429\)/);
  });

  it('throws when the model returns no content', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { choices: [{ message: {} }] }));
    await expect(svc.request('llama-3.3-70b-versatile', 'hi')).rejects.toThrow(/empty/);
  });
});
