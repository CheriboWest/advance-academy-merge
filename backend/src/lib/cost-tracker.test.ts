import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCostBucket } from './cost-tracker.js';

test('cost bucket: adzuna/reed are zero-cost and do not affect the total', () => {
  const bucket = newCostBucket('test.job-search');
  const before = bucket.total();
  const a = bucket.adzuna('adzuna.search', 1);
  const r = bucket.reed('reed.search', 1);
  assert.equal(a, 0);
  assert.equal(r, 0);
  assert.equal(bucket.total(), before);
});

test('cost bucket: exa still accrues cost (sanity that free sources are distinct)', () => {
  const bucket = newCostBucket('test.job-search');
  const cost = bucket.exa('exa.search', 1);
  assert.ok(cost > 0, 'exa search should have a non-zero cost');
});
