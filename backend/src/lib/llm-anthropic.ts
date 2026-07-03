/**
 * Anthropic SDK helpers + feature config (used when features need SDK options, e.g. high max_tokens).
 * For JSON-over-HTTP without SDK, see services/llm.service.ts.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { LlmFeature } from '../config/llm.js';
import { getLlmApiKey, getLlmConfig } from '../config/llm.js';

export function assertLlmConfigured(feature: LlmFeature): void {
  const config = getLlmConfig(feature);
  if (!config.enabled) {
    const err = new Error(
      'LLM_API_KEY is not set in backend environment. Add it to backend/.env (see backend/.env.example).',
    );
    Object.assign(err, { statusCode: 503 });
    throw err;
  }
}

export interface AnthropicClientOptions {
  /** Abort the SDK request after this many ms. Omit to keep the SDK default (10 min). */
  timeoutMs?: number;
  /** SDK-level retry count. Omit to keep the SDK default (2). */
  maxRetries?: number;
}

export function createAnthropicClient(
  feature: LlmFeature = 'default',
  options: AnthropicClientOptions = {},
): Anthropic {
  const apiKey = getLlmApiKey(feature).trim();
  if (!apiKey) {
    const err = new Error('LLM_API_KEY is not set.');
    Object.assign(err, { statusCode: 503 });
    throw err;
  }
  // Only override timeout/maxRetries when a caller opts in, so features that make large,
  // slow calls (e.g. CV Optimizer at max_tokens 16384) keep the SDK's generous defaults.
  return new Anthropic({
    apiKey,
    ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });
}

export function getFeatureModel(feature: LlmFeature): string {
  return getLlmConfig(feature).model;
}

function isRateLimit(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = ('status' in err ? (err as { status?: number }).status : undefined)
    ?? ('statusCode' in err ? (err as { statusCode?: number }).statusCode : undefined);
  return status === 429;
}

// Retries fn up to maxRetries times on 429, with exponential backoff (1s, 2s, 4s).
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRateLimit(err) && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  return fn();
}
