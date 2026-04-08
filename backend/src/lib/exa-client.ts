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
