import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchReed } from './reed-client.js';

const realFetch = globalThis.fetch;

function withKey(fn: () => Promise<void>): Promise<void> {
  const prev = process.env.REED_API_KEY;
  process.env.REED_API_KEY = 'reed-test-key';
  return fn().finally(() => {
    if (prev === undefined) delete process.env.REED_API_KEY;
    else process.env.REED_API_KEY = prev;
    globalThis.fetch = realFetch;
  });
}

test('searchReed: missing key throws statusCode 503', async () => {
  const prev = process.env.REED_API_KEY;
  delete process.env.REED_API_KEY;
  try {
    await assert.rejects(
      searchReed({ keywords: 'engineer' }),
      (err: Error & { statusCode?: number }) => {
        assert.equal(err.statusCode, 503);
        return true;
      },
    );
  } finally {
    if (prev !== undefined) process.env.REED_API_KEY = prev;
  }
});

test('searchReed: 200 returns results array', async () => {
  await withKey(async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [{ jobId: 1, jobTitle: 'Data Analyst', jobUrl: 'https://reed/1', date: '01/07/2026' }],
          totalResults: 1,
        }),
        { status: 200 },
      )) as typeof fetch;
    const results = await searchReed({ keywords: 'analyst', locationName: 'London' });
    assert.equal(results.length, 1);
    assert.equal(results[0].jobTitle, 'Data Analyst');
  });
});

test('searchReed: sends Basic auth header with key as username, empty password', async () => {
  await withKey(async () => {
    let seenAuth = '';
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      seenAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;
    await searchReed({ keywords: 'x' });
    const expected = `Basic ${Buffer.from('reed-test-key:').toString('base64')}`;
    assert.equal(seenAuth, expected);
  });
});

test('searchReed: 401 is not retried (single call) and throws', async () => {
  await withKey(async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('unauthorized', { status: 401 });
    }) as typeof fetch;
    await assert.rejects(searchReed({ keywords: 'x' }), (err: Error & { status?: number }) => {
      assert.equal(err.status, 401);
      return true;
    });
    assert.equal(calls, 1);
  });
});
