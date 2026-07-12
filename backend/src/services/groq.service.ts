// Groq provider — the cross-provider fallback when the whole Gemini chain is quota-exhausted. Free
// tier allows far more calls/day than Gemini. OpenAI-compatible chat-completions API. Groq has no
// arbitrary responseSchema, so `json` uses json_object mode (our prompts already say "JSON"); the
// schema arg is ignored — the logic layer's parser tolerates minor shape drift.
import type { ILlmProvider, ILogger } from '../types/index.js';
import { AppError } from '../lib/errors.js';

const URL = 'https://api.groq.com/openai/v1/chat/completions';

interface GroqResponse {
  choices?: { message?: { content?: string } }[];
}

export class GroqService implements ILlmProvider {
  readonly label = 'groq';
  readonly models: string[];

  constructor(
    private readonly apiKey: string,
    models: string | string[],
    private readonly logger: ILogger,
  ) {
    const list = (Array.isArray(models) ? models : models.split(',')).map((m) => m.trim()).filter(Boolean);
    this.models = list.length ? list : ['llama-3.3-70b-versatile'];
  }

  async request(model: string, prompt: string, json = false, _schema?: object): Promise<string> {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      this.logger.warn(`Groq ${model} failed`, res.status);
      throw AppError.upstream(`Groq request failed (${res.status})`);
    }
    const data = (await res.json()) as GroqResponse;
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw AppError.upstream('Groq returned empty output');
    return text;
  }
}
