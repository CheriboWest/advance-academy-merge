import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJsonQuota } from './credits.js';

/**
 * The coaching quota crosses the wire as `coachingCredits` on GET /api/account/me
 * and decides whether the booking form is usable. Two values must never blur into
 * each other: `null` (admin, unlimited, book freely) and `0` (quota spent, the
 * form is blocked). Infinity is what `getCoachingCredits` returns for an admin,
 * and it cannot survive JSON — hence this mapping.
 */

test('unlimited (Infinity) becomes null on the wire', () => {
  assert.equal(toJsonQuota(Infinity), null);
});

test('a spent quota stays 0 and is never confused with unlimited', () => {
  assert.equal(toJsonQuota(0), 0);
  assert.notEqual(toJsonQuota(0), toJsonQuota(Infinity));
});

test('a real balance passes through untouched', () => {
  assert.equal(toJsonQuota(1), 1);
  assert.equal(toJsonQuota(3), 3);
});

test('NaN reads as unlimited-shaped null rather than leaking NaN', () => {
  // JSON.stringify(NaN) is also "null"; returning it explicitly keeps the type
  // honest instead of typing the field as number and shipping null anyway.
  assert.equal(toJsonQuota(NaN), null);
});

test('the mapped value survives a JSON round-trip unchanged', () => {
  for (const value of [Infinity, 0, 1, 42]) {
    const wire = toJsonQuota(value);
    assert.deepEqual(JSON.parse(JSON.stringify({ q: wire })), { q: wire });
  }
});
