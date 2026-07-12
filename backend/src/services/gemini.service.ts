// Google Gemini provider. Pure third-party adapter — no DB, no caching, no cross-model chaining
// (that lives in LlmChain). Auth is the AI Studio API key, sent as ?key= on generateContent.
import type { ILlmProvider, ILogger } from '../types/index.js';
import { AppError } from '../lib/errors.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export class GeminiService implements ILlmProvider {
  readonly label = 'gemini';
  readonly models: string[];

  constructor(
    private readonly apiKey: string,
    // One or more model ids (string or comma-separated). Each free model has its own daily quota;
    // LlmChain tries them in order, so a chain multiplies capacity.
    models: string | string[],
    private readonly logger: ILogger,
  ) {
    const list = (Array.isArray(models) ? models : models.split(',')).map((m) => m.trim()).filter(Boolean);
    this.models = list.length ? list : ['gemini-flash-lite-latest'];
  }

  // Call one model. `json` asks for a JSON body; `schema` turns on constrained decoding (Gemini
  // responseSchema) so the reply can't be malformed JSON. Throws AppError.upstream with the status
  // in the message — LlmChain reads "(429)"/"(503)" to decide whether to fall through.
  async request(model: string, prompt: string, json = false, schema?: object): Promise<string> {
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
