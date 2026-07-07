import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJobJson, isRetriableStatus } from './job-http.js';

const realFetch = globalThis.fetch;

function mockFetch(handler: () => Promise<Response> | Response): void {
  globalThis.fetch = (async () => handler()) as typeof fetch;
}
function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

test('isRetriableStatus: 429 and 5xx retriable, 4xx not', () => {
  assert.equal(isRetriableStatus(429), true);
  assert.equal(isRetriableStatus(500), true);
  assert.equal(isRetriableStatus(503), true);
  assert.equal(isRetriableStatus(400), false);
  assert.equal(isRetriableStatus(401), false);
  assert.equal(isRetriableStatus(404), false);
});

test('fetchJobJson: returns parsed JSON on 200', async (t) => {
  t.after(restoreFetch);
  mockFetch(() => new Response(JSON.stringify({ ok: 1, items: [1, 2] }), { status: 200 }));
  const out = await fetchJobJson<{ ok: number; items: number[] }>('https://x/api', { source: 'test' });
  assert.deepEqual(out, { ok: 1, items: [1, 2] });
});

test('fetchJobJson: retries on 429 then succeeds', async (t) => {
  t.after(restoreFetch);
  let calls = 0;
  mockFetch(() => {
    calls++;
    return calls < 3
      ? new Response('slow down', { status: 429 })
      : new Response(JSON.stringify({ done: true }), { status: 200 });
  });
  const out = await fetchJobJson<{ done: boolean }>('https://x/api', { source: 'test', backoffBaseMs: 0 });
  assert.equal(out.done, true);
  assert.equal(calls, 3);
});

test('fetchJobJson: exhausts retries on persistent 500 and throws with status', async (t) => {
  t.after(restoreFetch);
  let calls = 0;
  mockFetch(() => {
    calls++;
    return new Response('boom', { status: 500 });
  });
  await assert.rejects(
    fetchJobJson('https://x/api', { source: 'test', backoffBaseMs: 0 }),
    (err: Error & { status?: number }) => {
      assert.equal(err.status, 500);
      return true;
    },
  );
  assert.equal(calls, 3); // 3 attempts total
});

test('fetchJobJson: does NOT retry a 400 (single call)', async (t) => {
  t.after(restoreFetch);
  let calls = 0;
  mockFetch(() => {
    calls++;
    return new Response('bad', { status: 400 });
  });
  await assert.rejects(fetchJobJson('https://x/api', { source: 'test' }), (err: Error & { status?: number }) => {
    assert.equal(err.status, 400);
    return true;
  });
  assert.equal(calls, 1);
});
