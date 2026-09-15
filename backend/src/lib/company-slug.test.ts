import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { companySlug } from './company-slug.js';

/**
 * Asserts this TS port against career-hub's Python, via the fixture the Python
 * generated. A failure here means the two have drifted and the shared
 * `companies.slug` would start splitting into duplicates — fix the port (or
 * regenerate the fixture if the Python rule deliberately changed).
 */
const fixture = JSON.parse(
  readFileSync(new URL('./company-slug.cases.json', import.meta.url), 'utf8'),
) as { cases: { name: string; slug: string }[] };

test('companySlug matches the Python implementation on every fixture case', () => {
  assert.ok(fixture.cases.length > 0, 'fixture is empty');
  for (const { name, slug } of fixture.cases) {
    assert.equal(companySlug(name), slug, `name: ${JSON.stringify(name)}`);
  }
});

test('companySlug never returns empty', () => {
  for (const name of ['', '   ', '!!!', '<b></b>', '---', 'Ltd']) {
    assert.notEqual(companySlug(name), '', `name: ${JSON.stringify(name)}`);
  }
});
