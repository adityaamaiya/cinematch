import { describe, it, expect, vi } from 'vitest';
import { LlmChain } from '../src/services/llmChain.js';
import { AppError } from '../src/lib/errors.js';
import { Logger } from '../src/lib/logger.js';
import type { ILlmProvider } from '../src/types/index.js';

// A fake provider whose per-model behaviour is scripted: a string → return it, a number → throw an
// upstream error with that HTTP status in the message (so the chain's 429/503 regex sees it).
function provider(label: string, models: Record<string, string | number>): ILlmProvider {
  return {
    label,
    models: Object.keys(models),
    request: vi.fn(async (model: string) => {
      const r = models[model];
      if (typeof r === 'number') throw AppError.upstream(`${label} request failed (${r})`);
      return r;
    }),
  };
}

const log = new Logger('test');

describe('LlmChain.generate', () => {
  it('returns the primary model with fallback=false', async () => {
    const chain = new LlmChain([provider('gemini', { 'model-a': 'ok', 'model-b': 'x' })], log);
    expect(await chain.generate('hi')).toEqual({ text: 'ok', model: 'model-a', fallback: false });
  });

  it('falls through to the next model on 429 and flags fallback=true', async () => {
    const chain = new LlmChain([provider('gemini', { 'model-a': 429, 'model-b': 'ok' })], log);
    expect(await chain.generate('hi')).toEqual({ text: 'ok', model: 'model-b', fallback: true });
  });

  it('falls through to a second provider (Groq) after every Gemini model is exhausted', async () => {
    const chain = new LlmChain(
      [provider('gemini', { 'gemini-a': 429, 'gemini-b': 503 }), provider('groq', { 'llama-3.3': 'from groq' })],
      log,
    );
    expect(await chain.generate('hi')).toEqual({ text: 'from groq', model: 'llama-3.3', fallback: true });
  });

  it('throws when every model in every provider is exhausted', async () => {
    const chain = new LlmChain(
      [provider('gemini', { 'gemini-a': 429 }), provider('groq', { 'llama-3.3': 429 })],
      log,
    );
    await expect(chain.generate('hi')).rejects.toThrow(/request failed \(429\)/);
  });

  it('propagates a non-transient error immediately (does not fall through)', async () => {
    const groq = provider('groq', { 'llama-3.3': 'never reached' });
    const chain = new LlmChain([provider('gemini', { 'gemini-a': 500 }), groq], log);
    await expect(chain.generate('hi')).rejects.toThrow(/request failed \(500\)/);
    expect(groq.request).not.toHaveBeenCalled();
  });
});
