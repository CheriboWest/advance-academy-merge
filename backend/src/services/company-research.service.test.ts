import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSparse,
  cleanStringList,
  enforceCitations,
  normaliseUrl,
} from './company-research.service.js';

/**
 * These cover the guard that makes the company brief safe to hand a coach.
 *
 * The prompt asks the model to cite every claim; `enforceCitations` is what
 * makes ignoring that request impossible. If it ever softens, an invented
 * funding round reaches the coach, then the student, then the interview — the
 * exact failure the whole service is built to prevent. So the bar here is
 * deliberately harsh: anything not provably from a fetched page is dropped.
 */

const SOURCES = [
  'https://monzo.com/about',
  'https://techcrunch.com/2026/01/monzo-raises',
];

test('a claim citing a fetched page is kept', () => {
  const { kept, dropped } = enforceCitations(
    [{ claim: 'Monzo is a UK digital bank.', sourceUrl: 'https://monzo.com/about' }],
    SOURCES,
  );
  assert.equal(dropped, 0);
  assert.deepEqual(kept, [
    { claim: 'Monzo is a UK digital bank.', sourceUrl: 'https://monzo.com/about' },
  ]);
});

test('a claim citing a page we never fetched is dropped', () => {
  // The signature of a hallucination: a plausible claim with a plausible URL
  // that was never in the source set.
  const { kept, dropped } = enforceCitations(
    [{ claim: 'Monzo raised $500m in 2026.', sourceUrl: 'https://forbes.com/monzo' }],
    SOURCES,
  );
  assert.equal(kept.length, 0);
  assert.equal(dropped, 1);
});

test('a claim with no source at all is dropped', () => {
  const { kept, dropped } = enforceCitations([{ claim: 'They are growing fast.' }], SOURCES);
  assert.equal(kept.length, 0);
  assert.equal(dropped, 1);
});

test('an empty claim is dropped even with a valid source', () => {
  const { kept, dropped } = enforceCitations(
    [{ claim: '   ', sourceUrl: 'https://monzo.com/about' }],
    SOURCES,
  );
  assert.equal(kept.length, 0);
  assert.equal(dropped, 1);
});

test('trailing slashes and query strings still match', () => {
  // The model echoes URLs back imperfectly. Punishing that would drop good
  // claims, so matching is on origin + path.
  const { kept } = enforceCitations(
    [{ claim: 'Real claim.', sourceUrl: 'https://monzo.com/about/?utm_source=chatgpt' }],
    SOURCES,
  );
  assert.equal(kept.length, 1);
  // Rewritten to the canonical URL so the UI can link it.
  assert.equal(kept[0].sourceUrl, 'https://monzo.com/about');
});

test('good and bad claims in one array are separated, not discarded together', () => {
  const { kept, dropped } = enforceCitations(
    [
      { claim: 'Cited.', sourceUrl: 'https://monzo.com/about' },
      { claim: 'Invented.', sourceUrl: 'https://example.com/nope' },
      { claim: 'Also cited.', sourceUrl: 'https://techcrunch.com/2026/01/monzo-raises' },
    ],
    SOURCES,
  );
  assert.equal(kept.length, 2);
  assert.equal(dropped, 1);
});

test('a non-array from the model yields nothing rather than throwing', () => {
  assert.deepEqual(enforceCitations(undefined, SOURCES), { kept: [], dropped: 0 });
  assert.deepEqual(enforceCitations('overview text', SOURCES), { kept: [], dropped: 0 });
});

test('nothing survives when no page was fetched', () => {
  const { kept, dropped } = enforceCitations(
    [{ claim: 'Anything.', sourceUrl: 'https://monzo.com/about' }],
    [],
  );
  assert.equal(kept.length, 0);
  assert.equal(dropped, 1);
});

test('normaliseUrl is case- and slash-insensitive, and survives junk', () => {
  assert.equal(normaliseUrl('HTTPS://Monzo.COM/About/'), 'https://monzo.com/about');
  assert.equal(normaliseUrl('not a url'), 'not a url');
});

test('cleanStringList keeps only trimmed strings, capped', () => {
  assert.deepEqual(cleanStringList([' a ', '', 'b', 42, null, 'c'], 2), ['a', 'b']);
  assert.deepEqual(cleanStringList('not a list', 3), []);
});

// ── Sparse assessment ──────────────────────────────────────────────────────

const richSources = [
  { url: 'https://monzo.com/about', title: null, provider: 'jina' as const },
  { url: 'https://techcrunch.com/x', title: null, provider: 'exa' as const },
  { url: 'https://monzo.com/careers', title: null, provider: 'exa' as const },
];

const registry = {
  companyNumber: '09446231',
  companyName: 'MONZO BANK LIMITED',
  companyStatus: 'active',
  companyType: 'ltd',
  dateOfCreation: '2015-02-06',
  registeredAddress: 'London',
  sicCodes: ['64191'],
};

test('a well-sourced brief is not sparse', () => {
  const { sparse } = assessSparse({
    sources: richSources,
    totalChars: 20_000,
    registry,
    citedClaimCount: 12,
    hadCompanyUrl: true,
  });
  assert.equal(sparse, false);
});

test('plenty of text but nothing citable is still sparse', () => {
  // The case that matters most: pages loaded, tokens spent, and not one claim
  // could be tied to them. Length is not knowledge.
  const { sparse, reasons } = assessSparse({
    sources: richSources,
    totalChars: 20_000,
    registry,
    citedClaimCount: 0,
    hadCompanyUrl: true,
  });
  assert.equal(sparse, true);
  assert.ok(reasons.some((r) => r.includes('source behind it')));
});

test('a single short page is sparse and says why', () => {
  const { sparse, reasons } = assessSparse({
    sources: [richSources[0]],
    totalChars: 400,
    registry: null,
    citedClaimCount: 2,
    hadCompanyUrl: true,
  });
  assert.equal(sparse, true);
  assert.ok(reasons.some((r) => r.includes('Only 1 usable page')));
  assert.ok(reasons.some((r) => r.includes('too short')));
});

test('a missing company website is called out', () => {
  const { reasons } = assessSparse({
    sources: [richSources[1], richSources[2]],
    totalChars: 20_000,
    registry,
    citedClaimCount: 8,
    hadCompanyUrl: false,
  });
  assert.ok(reasons.some((r) => r.includes('No company website')));
});

test('registry facts alone do not make a brief', () => {
  const { sparse } = assessSparse({
    sources: [],
    totalChars: 0,
    registry,
    citedClaimCount: 0,
    hadCompanyUrl: false,
  });
  assert.equal(sparse, true);
});
