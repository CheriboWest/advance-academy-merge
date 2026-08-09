import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDelta } from './admin.js';

/**
 * The two balance deltas (`creditDelta`, `coachingDelta`) arrive as untyped JSON.
 * Anything that slips past this validator is written straight to a balance, so a
 * fractional or coerced value becomes a wrong number of credits or free coaching
 * sessions. `null` means "reject with 400", never "treat as zero".
 */

test('whole numbers pass through, sign included', () => {
  assert.equal(readDelta(5), 5);
  assert.equal(readDelta(-2), -2);
  assert.equal(readDelta(0), 0);
});

test('numeric strings are accepted — clients send form values', () => {
  assert.equal(readDelta('3'), 3);
  assert.equal(readDelta('-1'), -1);
});

test('fractions are rejected rather than rounded', () => {
  assert.equal(readDelta(1.5), null);
  assert.equal(readDelta('2.7'), null);
});

test('booleans cannot buy a session', () => {
  // Number(true) is 1; without the typeof guard this granted a free credit.
  assert.equal(readDelta(true), null);
  assert.equal(readDelta(false), null);
});

test('null, undefined and objects are rejected', () => {
  assert.equal(readDelta(null), null);
  assert.equal(readDelta(undefined), null);
  assert.equal(readDelta({}), null);
  assert.equal(readDelta([]), null);
});

test('nonsense strings and non-finite numbers are rejected', () => {
  assert.equal(readDelta('abc'), null);
  assert.equal(readDelta(NaN), null);
  assert.equal(readDelta(Infinity), null);
});
