import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResolvedCountry, SUPPORTED_COUNTRY_CODES } from './location-resolver.js';

test('normalizeResolvedCountry: supported codes pass through (lowercased)', () => {
  assert.equal(normalizeResolvedCountry('us'), 'us');
  assert.equal(normalizeResolvedCountry('US'), 'us');
  assert.equal(normalizeResolvedCountry(' De '), 'de');
});

test('normalizeResolvedCountry: "uk" alias → "gb"', () => {
  assert.equal(normalizeResolvedCountry('uk'), 'gb');
  assert.equal(normalizeResolvedCountry('UK'), 'gb');
  assert.equal(normalizeResolvedCountry('gb'), 'gb');
});

test('normalizeResolvedCountry: uncovered / junk / empty → null', () => {
  assert.equal(normalizeResolvedCountry('vn'), null); // Vietnam not covered
  assert.equal(normalizeResolvedCountry('hk'), null); // Hong Kong not covered
  assert.equal(normalizeResolvedCountry('null'), null);
  assert.equal(normalizeResolvedCountry(''), null);
  assert.equal(normalizeResolvedCountry('  '), null);
  assert.equal(normalizeResolvedCountry(undefined), null);
  assert.equal(normalizeResolvedCountry(42), null);
});

test('SUPPORTED_COUNTRY_CODES: includes gb + the Adzuna countries', () => {
  for (const code of ['gb', 'us', 'de', 'au', 'ca', 'fr', 'in', 'nl', 'sg', 'nz', 'mx']) {
    assert.ok(SUPPORTED_COUNTRY_CODES.has(code), `${code} should be supported`);
  }
});
