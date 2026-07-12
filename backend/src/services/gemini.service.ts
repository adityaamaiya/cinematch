// Google Gemini HTTP client. Pure third-party adapter — no DB, no caching (that lives in the logic
// layer). Auth is the AI Studio API key, sent as ?key= on the generateContent endpoint.
import type { IGeminiService, ILogger } from '../types/index.js';
import { AppError } from '../lib/errors.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export class GeminiService implements IGeminiService {
  private readonly models: string[];

  constructor(
    private readonly apiKey: string,
    // One or more model ids, tried in order. Each free model has its own daily quota, so a chain
    // (e.g. flash-lite → flash) multiplies capacity: on 429/503 we drop to the next model.
    models: string | string[],
    private readonly logger: ILogger,
  ) {
    const list = (Array.isArray(models) ? models : models.split(',')).map((m) => m.trim()).filter(Boolean);
    this.models = list.length ? list : ['gemini-flash-lite-latest'];
  }

  // Send a prompt, return the model's text. `json` asks the model for a JSON body (response mime);
  // `schema` turns on constrained decoding so the reply can't be malformed JSON. On a transient
  // 429/503 (quota exhausted / overload) we fall through to the next model in the chain; only when
  // every model is exhausted do we throw — then ScoreLogic falls back to the statistical line.
  async generate(prompt: string, json = false, schema?: object): Promise<string> {
    let lastErr: unknown;
    for (const model of this.models) {
      try {
        return await this.request(model, prompt, json, schema);
      } catch (err) {
        if (!(err instanceof AppError && /\((429|503)\)/.test(err.message))) throw err;
        lastErr = err; // quota/overload — try the next model
      }
    }
    throw lastErr;
  }

  private async request(model: string, prompt: string, json: boolean, schema?: object): Promise<string> {
    const url = `${BASE}/models/${model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // maxOutputTokens is generous because gemini-*-flash are thinking models — they spend
        // tokens reasoning before emitting, so a tight budget yields an empty MAX_TOKENS reply.
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
          ...(json ? { responseMimeType: 'application/json' } : {}),
          ...(schema ? { responseSchema: schema } : {}),
        },
      }),
    });
    if (!res.ok) {
      this.logger.warn(`Gemini ${model} failed`, res.status);
      throw AppError.upstream(`Gemini request failed (${res.status})`);
    }
    const data = (await res.json()) as GeminiResponse;
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text.trim()) throw AppError.upstream('Gemini returned empty output');
    return text;
  }
}
