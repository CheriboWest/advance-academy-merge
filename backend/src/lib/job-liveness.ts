/**
 * Liveness check for job URLs (D5) — drop links that clearly point at a closed/gone
 * vacancy before we show them.
 *
 * Strategy: HTTP HEAD each URL (following redirects) with a short timeout, in parallel
 * with a small concurrency cap. We only DROP a job on an unambiguous "gone" status
 * (404 / 410). Everything else — 200, 3xx, 405 (HEAD not allowed), 429, or any network
 * error/timeout — is FAIL-OPEN (job kept), because a false drop hides a real vacancy.
 *
 * Caveat (documented): Adzuna `redirect_url`s go through Adzuna's own redirector, which
 * often returns 200 even when the underlying posting is closed. So this check is most
 * effective on direct employer/Exa URLs and only partially effective on Adzuna links.
 */
import type { ExaJobListing } from '../types/dream-company.js';

export interface LivenessOptions {
  timeoutMs: number;
  concurrency?: number;
}

export interface LivenessResult {
  live: ExaJobListing[];
  checked: number;
  dropped: number;
}

/** True if the URL should be DROPPED (definitively gone). Never throws. */
async function isDead(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    return res.status === 404 || res.status === 410;
  } catch {
    return false; // network error / timeout → fail-open (keep)
  } finally {
    clearTimeout(timer);
  }
}

/** Run `worker` over `items` with at most `concurrency` in flight. */
async function mapLimit<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Return only the jobs whose URL is not definitively dead. Fail-open on any uncertainty.
 */
export async function filterLiveJobs(jobs: ExaJobListing[], opts: LivenessOptions): Promise<LivenessResult> {
  if (jobs.length === 0) return { live: [], checked: 0, dropped: 0 };
  const concurrency = opts.concurrency ?? 8;
  const deadFlags = await mapLimit(jobs, concurrency, (job) =>
    job.url ? isDead(job.url, opts.timeoutMs) : Promise.resolve(false),
  );
  const live = jobs.filter((_, i) => !deadFlags[i]);
  return { live, checked: jobs.length, dropped: jobs.length - live.length };
}
