import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterLiveJobs } from './job-liveness.js';
import type { ExaJobListing } from '../types/dream-company.js';

const realFetch = globalThis.fetch;

function mockByStatus(map: Record<string, number>): void {
  globalThis.fetch = (async (url: string | URL) => {
    const status = map[String(url)] ?? 200;
    return new Response(null, { status });
  }) as typeof fetch;
}

function job(url: string): ExaJobListing {
  return { title: url, url, snippet: '' };
}

test('filterLiveJobs: drops 404/410, keeps 200/3xx/405 (fail-open)', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  mockByStatus({
    'https://x/live': 200,
    'https://x/gone': 404,
    'https://x/expired': 410,
    'https://x/method': 405, // HEAD not allowed → keep
  });
  const jobs = [job('https://x/live'), job('https://x/gone'), job('https://x/expired'), job('https://x/method')];
  const res = await filterLiveJobs(jobs, { timeoutMs: 1000 });
  assert.deepEqual(res.live.map((j) => j.url), ['https://x/live', 'https://x/method']);
  assert.equal(res.checked, 4);
  assert.equal(res.dropped, 2);
});

test('filterLiveJobs: network error is fail-open (job kept)', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  globalThis.fetch = (async () => {
    throw new Error('ECONNRESET');
  }) as typeof fetch;
  const jobs = [job('https://x/unknown')];
  const res = await filterLiveJobs(jobs, { timeoutMs: 1000 });
  assert.equal(res.live.length, 1); // kept despite the error
  assert.equal(res.dropped, 0);
});

test('filterLiveJobs: empty input short-circuits', async () => {
  const res = await filterLiveJobs([], { timeoutMs: 1000 });
  assert.deepEqual(res, { live: [], checked: 0, dropped: 0 });
});
