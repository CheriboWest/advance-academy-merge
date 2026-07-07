/**
 * Shared HTTP helper for the live-vacancy job-source clients (Adzuna, Reed).
 *
 * Provides a single fetch-with-timeout-and-retry primitive so both clients share
 * identical NFR behaviour (JS work order §7): per-source AbortController timeout
 * (JOB_SOURCE_TIMEOUT_MS), and retry on 429 / 5xx with 1s → 2s → 4s backoff, up to
 * 3 attempts. Uses global fetch (Node 18+).
 */
import { getJobSourceTimeoutMs } from '../config/job-source.js';

/** An HTTP error carrying the response status so callers/retry can branch on it. */
export interface JobHttpError extends Error {
  status?: number;
}

function httpError(message: string, status?: number): JobHttpError {
  const err = new Error(message) as JobHttpError;
  err.status = status;
  return err;
}

/** Retriable = rate-limit (429) or any server error (5xx). Client 4xx are not retried. */
export function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export interface FetchJobJsonOptions {
  headers?: Record<string, string>;
  /** Per-attempt timeout in ms. Defaults to JOB_SOURCE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Total attempts (including the first). Default 3. */
  maxRetries?: number;
  /** Backoff base in ms; attempt N waits base * 2^N. Default 1000 (→ 1s, 2s, 4s). */
  backoffBaseMs?: number;
  /** Label used in log lines, e.g. "adzuna" / "reed". */
  source: string;
}

/**
 * Fetch a URL and parse JSON, retrying on 429/5xx with exponential backoff and
 * enforcing a per-attempt timeout. Throws a {@link JobHttpError} (with `.status`
 * when known) on the final failure — never returns a non-ok body.
 */
export async function fetchJobJson<T>(url: string, opts: FetchJobJsonOptions): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? getJobSourceTimeoutMs();
  const backoffBaseMs = opts.backoffBaseMs ?? 1000;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: opts.headers, signal: controller.signal });
      if (!res.ok) {
        // Drain the body for a useful message, but don't fail if it's empty/non-text.
        const body = await res.text().catch(() => '');
        throw httpError(
          `[${opts.source}] HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
          res.status,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      const status = (err as JobHttpError)?.status;
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const retriable = isTimeout || (typeof status === 'number' && isRetriableStatus(status));
      const hasAttemptsLeft = attempt < maxRetries - 1;
      if (retriable && hasAttemptsLeft) {
        const backoff = backoffBaseMs * 2 ** attempt; // default 1s, 2s, 4s
        if (status === 429) {
          // eslint-disable-next-line no-console
          console.warn(`[${opts.source}] 429 rate-limited — backing off ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
        }
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable in practice (loop either returns or throws), but satisfies the type.
  throw lastErr instanceof Error ? lastErr : httpError(`[${opts.source}] request failed`);
}
