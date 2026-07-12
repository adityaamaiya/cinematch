// Google Gemini HTTP client. Pure third-party adapter — no DB, no caching (that lives in the logic
// layer). Auth is the AI Studio API key, sent as ?key= on the generateContent endpoint.
import type { IGeminiService, ILogger } from '../types/index.js';
import { AppError } from '../lib/errors.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export class GeminiService implements IGeminiService {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly logger: ILogger,
  ) {}

  // Send a prompt, return the model's text. `json` asks the model for a JSON body (response mime);
  // `schema` turns on constrained decoding so the reply can't be malformed JSON. 429/503 are
  // transient (free-tier rate limit / overload) — retried once after a short backoff.
  async generate(prompt: string, json = false, schema?: object): Promise<string> {
    try {
      return await this.request(prompt, json, schema);
    } catch (err) {
      if (!(err instanceof AppError && /\((429|503)\)/.test(err.message))) throw err;
      await new Promise((r) => setTimeout(r, 1200));
      return this.request(prompt, json, schema);
    }
  }

  private async request(prompt: string, json: boolean, schema?: object): Promise<string> {
    const url = `${BASE}/models/${this.model}:generateContent?key=${this.apiKey}`;
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
      this.logger.warn(`Gemini ${this.model} failed`, res.status);
      throw AppError.upstream(`Gemini request failed (${res.status})`);
    }
    const data = (await res.json()) as GeminiResponse;
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text.trim()) throw AppError.upstream('Gemini returned empty output');
    return text;
  }
}
