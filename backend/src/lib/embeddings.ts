/**
 * Embeddings utility — calls a Voyage AI or OpenAI-compatible /embeddings endpoint.
 *
 * Config (via env):
 *   EMBEDDING_API_KEY   — defaults to LLM_API_KEY
 *   EMBEDDING_BASE_URL  — defaults to https://api.voyageai.com/v1 (anthropic) or https://api.openai.com/v1 (openai)
 *   EMBEDDING_MODEL     — defaults to voyage-3 (anthropic) or text-embedding-3-small (openai)
 */
import { getLlmApiKey, getLlmConfig } from '../config/llm.js';

export class EmbeddingError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

interface EmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function getEmbeddingConfig(): EmbeddingConfig {
  const provider = getLlmConfig('cvOptimizer').provider;

  const defaultBaseUrl =
    provider === 'anthropic'
      ? 'https://api.voyageai.com/v1'
      : 'https://api.openai.com/v1';

  const defaultModel =
    provider === 'anthropic' ? 'voyage-3' : 'text-embedding-3-small';

  const apiKey =
    process.env.EMBEDDING_API_KEY?.trim() ||
    getLlmApiKey();

  const baseUrl =
    process.env.EMBEDDING_BASE_URL?.trim() || defaultBaseUrl;

  const model =
    process.env.EMBEDDING_MODEL?.trim() || defaultModel;

  return { apiKey, baseUrl, model };
}

interface EmbeddingsResponse {
  data: Array<{ embedding: number[] }>;
}

async function callEmbeddingsEndpoint(inputs: string[]): Promise<number[][]> {
  const { apiKey, baseUrl, model } = getEmbeddingConfig();

  if (!apiKey) {
    throw new EmbeddingError('No API key available for embeddings. Set EMBEDDING_API_KEY or LLM_API_KEY.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: inputs, model }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new EmbeddingError(
        `Embeddings request failed with status ${response.status}: ${errorText}`,
      );
    }

    const data = (await response.json()) as EmbeddingsResponse;

    if (!Array.isArray(data.data) || data.data.length === 0) {
      throw new EmbeddingError('Embeddings response contained no data.');
    }

    return data.data.map((item) => item.embedding);
  } catch (error) {
    if (error instanceof EmbeddingError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new EmbeddingError('Embeddings request timed out.');
    }

    throw new EmbeddingError('Embeddings request failed.', error);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Embed a single text string and return its vector.
 */
export async function embedText(text: string): Promise<number[]> {
  const vectors = await callEmbeddingsEndpoint([text]);
  return vectors[0];
}

/**
 * Embed multiple strings in one API call for efficiency.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return callEmbeddingsEndpoint(texts);
}
