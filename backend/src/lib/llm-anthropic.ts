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

export function createAnthropicClient(feature: LlmFeature = 'default'): Anthropic {
  const apiKey = getLlmApiKey(feature).trim();
  if (!apiKey) {
    const err = new Error('LLM_API_KEY is not set.');
    Object.assign(err, { statusCode: 503 });
    throw err;
  }
  return new Anthropic({ apiKey });
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
