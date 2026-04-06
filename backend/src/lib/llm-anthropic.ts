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

export function createAnthropicClient(): Anthropic {
  const apiKey = getLlmApiKey().trim();
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
