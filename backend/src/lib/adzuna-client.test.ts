import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchAdzuna } from './adzuna-client.js';

const realFetch = globalThis.fetch;

function withCreds(fn: () => Promise<void>): Promise<void> {
  const prevId = process.env.ADZUNA_APP_ID;
  const prevKey = process.env.ADZUNA_APP_KEY;
  process.env.ADZUNA_APP_ID = 'test-id';
  process.env.ADZUNA_APP_KEY = 'test-key';
  return fn().finally(() => {
    if (prevId === undefined) delete process.env.ADZUNA_APP_ID;
    else process.env.ADZUNA_APP_ID = prevId;
    if (prevKey === undefined) delete process.env.ADZUNA_APP_KEY;
    else process.env.ADZUNA_APP_KEY = prevKey;
    globalThis.fetch = realFetch;
  });
}

test('searchAdzuna: missing creds throws statusCode 503', async () => {
  const prevId = process.env.ADZUNA_APP_ID;
  const prevKey = process.env.ADZUNA_APP_KEY;
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
  try {
    await assert.rejects(
      searchAdzuna({ country: 'gb', what: 'engineer' }),
      (err: Error & { statusCode?: number }) => {
        assert.equal(err.statusCode, 503);
        return true;
      },
    );
  } finally {
    if (prevId !== undefined) process.env.ADZUNA_APP_ID = prevId;
    if (prevKey !== undefined) process.env.ADZUNA_APP_KEY = prevKey;
  }
});

test('searchAdzuna: 200 returns results array', async () => {
  await withCreds(async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: 'Senior Engineer', redirect_url: 'https://adzuna/x', created: '2026-07-01T00:00:00Z' },
          ],
          count: 1,
        }),
        { status: 200 },
      )) as typeof fetch;
    const results = await searchAdzuna({ country: 'gb', what: 'engineer', where: 'London' });
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Senior Engineer');
  });
});

test('searchAdzuna: builds URL with country, what, where, sort_by=date and auth', async () => {
  await withCreds(async () => {
    let seenUrl = '';
    globalThis.fetch = (async (url: string | URL) => {
      seenUrl = String(url);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;
    await searchAdzuna({ country: 'gb', what: 'data scientist', where: 'Manchester' });
    assert.match(seenUrl, /\/jobs\/gb\/search\/1\?/);
    assert.match(seenUrl, /app_id=test-id/);
    assert.match(seenUrl, /app_key=test-key/);
    assert.match(seenUrl, /sort_by=date/);
    assert.match(seenUrl, /what=data\+scientist/);
    assert.match(seenUrl, /where=Manchester/);
  });
});

test('searchAdzuna: missing results field yields empty array', async () => {
  await withCreds(async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ count: 0 }), { status: 200 })) as typeof fetch;
    const results = await searchAdzuna({ country: 'gb', what: 'x' });
    assert.deepEqual(results, []);
  });
});
