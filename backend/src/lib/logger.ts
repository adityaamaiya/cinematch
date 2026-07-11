// Leveled logger injected as ILogger, so call sites don't depend on console. Swap freely.
import type { ILogger } from '../types/index.js';

export class Logger implements ILogger {
  constructor(private readonly scope = 'app') {}

  private line(level: string): string {
    return `[${level}] [${this.scope}]`;
  }

  info(message: string, meta?: unknown): void {
    console.log(this.line('INFO'), message, meta ?? '');
  }

  warn(message: string, meta?: unknown): void {
    console.warn(this.line('WARN'), message, meta ?? '');
  }

  error(message: string, meta?: unknown): void {
    console.error(this.line('ERROR'), message, meta ?? '');
  }
}
