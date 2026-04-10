/**
 * Thin HTTP client for the Voyage AI embedding API.
 * No npm package needed — plain fetch, same pattern as the Jina integration.
 *
 * Model: voyage-3.5-lite (1024 dims, $0.02/1M tokens, 200M free tier).
 * Docs: https://docs.voyageai.com/reference/embeddings-api
 */

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3.5-lite';

function getVoyageKey(): string | null {
  return process.env.VOYAGE_API_KEY?.trim() || null;
}

export function isVoyageConfigured(): boolean {
  return !!getVoyageKey();
}

/**
 * Embed one or more texts. Returns an array of number[] vectors (1024-dim).
 * Returns an empty array if VOYAGE_API_KEY is missing.
 * Throws on API errors.
 */
export async function embedTexts(
  texts: string[],
  inputType: 'document' | 'query' = 'document',
): Promise<number[][]> {
  const key = getVoyageKey();
  if (!key || texts.length === 0) return [];

  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  return data.data.map((d) => d.embedding);
}

/**
 * Embed a single text. Returns the vector or null if Voyage is not configured.
 */
export async function embedText(
  text: string,
  inputType: 'document' | 'query' = 'document',
): Promise<number[] | null> {
  const results = await embedTexts([text], inputType);
  return results[0] ?? null;
}
