// Ordered LLM fallback: try each provider's models in turn. A transient/quota failure (429/503)
// falls through to the next model; any other error propagates. Reports which model answered and
// whether it was a fallback (an earlier model was exhausted) so the UI can flag non-primary answers.
import type { ILlm, ILlmProvider, ILogger, LlmResult } from '../types/index.js';
import { AppError } from '../lib/errors.js';

export class LlmChain implements ILlm {
  private readonly attempts: { provider: ILlmProvider; model: string }[];

  constructor(providers: ILlmProvider[], private readonly logger: ILogger) {
    this.attempts = providers.flatMap((provider) => provider.models.map((model) => ({ provider, model })));
  }

  async generate(prompt: string, json = false, schema?: object, maxOutputTokens?: number): Promise<LlmResult> {
    let lastErr: unknown;
    for (let i = 0; i < this.attempts.length; i++) {
      const { provider, model } = this.attempts[i];
      try {
        const text = await provider.request(model, prompt, json, schema, maxOutputTokens);
        return { text, model, fallback: i > 0 };
      } catch (err) {
        // Only quota/overload falls through; anything else is a real fault worth surfacing.
        if (!(err instanceof AppError && /\((429|503)\)/.test(err.message))) throw err;
        this.logger.warn(`LLM ${provider.label}:${model} exhausted, trying next`);
        lastErr = err;
      }
    }
    throw lastErr ?? AppError.upstream('No LLM providers configured');
  }
}
