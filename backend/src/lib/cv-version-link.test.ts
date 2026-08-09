import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashCvText } from './cv-version-link.js';

/**
 * The hash is the dedupe key for `cv_versions` (migration 018). Getting it wrong
 * fails in two directions, both quiet: too strict and a student's CV is stored
 * once per tool that touched it, cluttering the Coaching context picker with
 * copies of the same document; too loose and two genuinely different CVs collide
 * on the unique index, so the second one silently resolves to the first and the
 * coach reads the wrong CV.
 */

const CV = 'Jane Doe\nData Analyst\n- Built a pipeline that cut load time 40%';

test('the same text hashes the same way', () => {
  assert.equal(hashCvText(CV), hashCvText(CV));
});

test('re-wrapping and re-indenting does not mint a new version', () => {
  // A paste into a textarea versus a PDF extraction of the same CV differ only
  // in whitespace. They are the same document and must reuse the same row.
  const rewrapped = 'Jane Doe\r\n  Data Analyst\t\n\n- Built a pipeline that cut load time 40%   ';
  assert.equal(hashCvText(rewrapped), hashCvText(CV));
});

test('case is not part of the identity', () => {
  assert.equal(hashCvText(CV.toUpperCase()), hashCvText(CV));
});

test('a real edit produces a different version', () => {
  const edited = CV.replace('40%', '60%');
  assert.notEqual(hashCvText(edited), hashCvText(CV));
});

test('different CVs do not collide', () => {
  assert.notEqual(hashCvText(CV), hashCvText('Sam Patel\nBackend Engineer\n- Shipped a billing service'));
});

test('hex sha256, so it fits a text column and an index', () => {
  assert.match(hashCvText(CV), /^[0-9a-f]{64}$/);
});
