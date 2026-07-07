import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withJobCache, buildJobCacheKey, clearJobCache } from './job-cache.js';

test('withJobCache: second call within TTL is a hit (producer runs once)', async () => {
  clearJobCache();
  let runs = 0;
  const producer = async () => {
    runs++;
    return { jobs: [1], error: null };
  };
  const a = await withJobCache('k1', 1000, producer, { now: 0 });
  const b = await withJobCache('k1', 1000, producer, { now: 500 });
  assert.equal(runs, 1);
  assert.equal(a.hit, false);
  assert.equal(b.hit, true);
  assert.deepEqual(b.value, { jobs: [1], error: null });
});

test('withJobCache: expired entry re-runs the producer', async () => {
  clearJobCache();
  let runs = 0;
  const producer = async () => {
    runs++;
    return runs;
  };
  await withJobCache('k2', 1000, producer, { now: 0 });
  const second = await withJobCache('k2', 1000, producer, { now: 1500 }); // past TTL
  assert.equal(runs, 2);
  assert.equal(second.hit, false);
});

test('withJobCache: shouldCache=false results are not cached', async () => {
  clearJobCache();
  let runs = 0;
  const producer = async () => {
    runs++;
    return { error: 'boom' };
  };
  await withJobCache('k3', 1000, producer, { now: 0, shouldCache: (r) => r.error === null });
  await withJobCache('k3', 1000, producer, { now: 100, shouldCache: (r) => r.error === null });
  assert.equal(runs, 2); // never cached → producer runs both times
});

test('buildJobCacheKey: order-insensitive on roles, case-insensitive', () => {
  const a = buildJobCacheKey('hybrid', 'London', ['Data Analyst', 'BI Developer']);
  const b = buildJobCacheKey('hybrid', 'london', ['bi developer', 'data analyst']);
  assert.equal(a, b);
});
