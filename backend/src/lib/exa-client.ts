import Exa from 'exa-js';

let cachedClient: Exa | null = null;

export function getExaClient(): Exa {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error(
      'EXA_API_KEY is not set in backend environment. Add it to backend/.env (see backend/.env.example).',
    );
    Object.assign(err, { statusCode: 503 });
    throw err;
  }

  cachedClient = new Exa(apiKey);
  return cachedClient;
}

function isRateLimit(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = ('status' in err ? (err as { status?: number }).status : undefined)
    ?? ('statusCode' in err ? (err as { statusCode?: number }).statusCode : undefined);
  if (status === 429) return true;
  // Some HTTP clients surface rate limit as a message string
  if ('message' in err && typeof (err as { message?: string }).message === 'string') {
    return (err as { message: string }).message.toLowerCase().includes('rate limit');
  }
  return false;
}

// Retries fn up to maxRetries times on 429, with exponential backoff (1s, 2s, 4s).
export async function withExaRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
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
