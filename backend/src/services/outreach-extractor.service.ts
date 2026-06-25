import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const BLOCKED_DOMAINS = ['linkedin.com', 'facebook.com'];
const EXTRACT_MAX_CHARS = 1200;

export function isBlockedDomain(targetUrl: string): boolean {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return BLOCKED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export async function extractContent(targetUrl: string, exaText?: string): Promise<string> {
  if (isBlockedDomain(targetUrl)) {
    return (exaText ?? '').slice(0, EXTRACT_MAX_CHARS);
  }

  try {
    const text = await extractTextFromUrl(targetUrl);
    return text.slice(0, EXTRACT_MAX_CHARS);
  } catch {
    // Fall back to Exa text if Jina fails and we happen to have it
    return (exaText ?? '').slice(0, EXTRACT_MAX_CHARS);
  }
}

export async function extractTextFromFile(buffer: Buffer, fileNameLower: string): Promise<string> {
  const isPdf = fileNameLower.endsWith('.pdf');
  const isDocx = fileNameLower.endsWith('.docx');

  if (!isPdf && !isDocx) {
    throw Object.assign(new Error('Only PDF and DOCX files are supported'), { statusCode: 400 });
  }

  let extractedText: string;

  if (isPdf) {
    const pdfData = await pdfParse(buffer);
    extractedText = pdfData.text;
  } else {
    const result = await mammoth.extractRawText({ buffer });
    extractedText = result.value;
  }

  if (!extractedText.trim()) {
    throw Object.assign(new Error('Could not extract text from the uploaded file'), { statusCode: 422 });
  }

  return extractedText.trim();
}

// Jina fetch tuning. A slow/flaky page must not hang the whole outreach flow (AAT-17).
const JINA_TIMEOUT_MS = Number(process.env.JINA_TIMEOUT_MS) || 15000;
const JINA_MAX_RETRIES = 3;

/**
 * A failure worth retrying: network error, request timeout (AbortError), 429, or any
 * 5xx. A 4xx (other than 429) is a permanent error and is thrown immediately.
 */
function isTransientJinaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ('name' in err && (err as { name?: string }).name === 'AbortError') return true;
  const status = 'status' in err ? (err as { status?: number }).status : undefined;
  if (typeof status === 'number') return status === 429 || status >= 500;
  // undici's fetch surfaces network failures as a TypeError ("fetch failed").
  if (err instanceof TypeError) return true;
  return false;
}

/**
 * Retries fn up to maxRetries times on transient failures, with exponential backoff
 * (1s, 2s, 4s). Mirrors withExaRetry in lib/exa-client.ts (AAT-17).
 */
async function withJinaRetry<T>(fn: () => Promise<T>, maxRetries = JINA_MAX_RETRIES): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isTransientJinaError(err) && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  return fn();
}

/** Single Jina fetch attempt with an enforced request timeout via AbortController. */
async function fetchJinaContent(targetUrl: string, headers: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
  try {
    const res = await fetch(`https://r.jina.ai/${targetUrl}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      // Attach `status` so isTransientJinaError can decide whether to retry.
      throw Object.assign(new Error(`Jina API failed with status ${res.status}`), { status: res.status });
    }

    // Jina returns a JSON object when requested with Accept: json
    // Format: { data: { title: string, content: string, url: string } }
    const data = await res.json() as any;
    const content = data?.data?.content || data?.text || data?.content;

    if (!content) {
      throw new Error('No content returned from URL');
    }

    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractTextFromUrl(targetUrl: string): Promise<string> {
  const jinaKey = process.env.JINA_API_KEY?.trim();

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (jinaKey) {
    headers['Authorization'] = `Bearer ${jinaKey}`;
  }

  // Add x-return-format if necessary, but Accept JSON usually defaults to markdown inside "content"
  try {
    return await withJinaRetry(() => fetchJinaContent(targetUrl, headers));
  } catch (err: any) {
    throw Object.assign(new Error(`Failed to extract URL: ${err.message}`), { statusCode: 500 });
  }
}
