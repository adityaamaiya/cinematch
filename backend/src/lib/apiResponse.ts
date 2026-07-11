// Builders for the standard ApiResponse<T> envelope.
import type { ApiResponse } from '../types/index.js';

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function fail(message: string, code = 'ERROR'): ApiResponse<never> {
  return { success: false, error: { message, code } };
}
