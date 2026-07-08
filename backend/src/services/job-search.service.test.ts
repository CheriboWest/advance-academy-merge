import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeLocation,
  normalizeAdzuna,
  normalizeReed,
  reedDateToIso,
  reedNotExpired,
  applyFreshness,
  finalizeJobs,
  dedupeJobs,
  topRoles,
  extractCity,
  filterByRoleRelevance,
  normalizeTitleTokens,
  searchLiveJobs,
  JOBS_UNAVAILABLE_ERROR,
} from './job-search.service.js';
import type { ExaJobListing } from '../types/dream-company.js';

// --- routing -------------------------------------------------------------

test('routeLocation: UK variants → uk/gb', () => {
  for (const loc of ['London, UK', 'Manchester', 'England', 'United Kingdom', 'Edinburgh, Scotland']) {
    assert.deepEqual(routeLocation(loc, 'hybrid'), { kind: 'uk', country: 'gb' });
  }
});

test('routeLocation: covered countries → adzuna/<code>', () => {
  assert.deepEqual(routeLocation('New York, United States', 'hybrid'), { kind: 'adzuna', country: 'us' });
  assert.deepEqual(routeLocation('Sydney, Australia', 'hybrid'), { kind: 'adzuna', country: 'au' });
  assert.deepEqual(routeLocation('Berlin, Germany', 'hybrid'), { kind: 'adzuna', country: 'de' });
});

test('routeLocation: outside coverage → unsupported (Issue 1: no Exa fallback)', () => {
  assert.deepEqual(routeLocation('Hanoi, Vietnam', 'hybrid'), { kind: 'unsupported' });
  assert.deepEqual(routeLocation('Hong Kong', 'hybrid'), { kind: 'unsupported' });
  assert.deepEqual(routeLocation('Ho Chi Minh City', 'hybrid'), { kind: 'unsupported' });
});

test('routeLocation: mode=exa forces exa even for UK', () => {
  assert.deepEqual(routeLocation('London', 'exa'), { kind: 'exa' });
});

// --- normalize -----------------------------------------------------------

test('normalizeAdzuna: maps fields, salary+company snippet, created→publishedDate', () => {
  const out = normalizeAdzuna({
    title: 'Senior Data Engineer',
    redirect_url: 'https://adzuna.example/job/1',
    created: '2026-07-01T09:00:00Z',
    description: 'Build pipelines and own the data platform.',
    salary_min: 40000,
    salary_max: 55000,
    company: { display_name: 'Acme Ltd' },
  });
  assert.equal(out.title, 'Senior Data Engineer');
  assert.equal(out.url, 'https://adzuna.example/job/1');
  assert.equal(out.publishedDate, '2026-07-01T09:00:00Z');
  assert.equal(out.snippet, '£40k–55k · Acme Ltd — Build pipelines and own the data platform.');
});

test('normalizeReed: maps fields, DD/MM/YYYY→ISO, employer snippet', () => {
  const out = normalizeReed({
    jobTitle: 'Business Analyst',
    jobUrl: 'https://reed.example/job/2',
    date: '30/06/2026',
    employerName: 'Globex',
    minimumSalary: 35000,
    maximumSalary: null,
    jobDescription: 'Requirements gathering and stakeholder work.',
  });
  assert.equal(out.title, 'Business Analyst');
  assert.equal(out.url, 'https://reed.example/job/2');
  assert.equal(out.publishedDate, '2026-06-30T00:00:00Z');
  assert.equal(out.snippet, '£35k+ · Globex — Requirements gathering and stakeholder work.');
});

test('reedDateToIso: valid and invalid inputs', () => {
  assert.equal(reedDateToIso('01/07/2026'), '2026-07-01T00:00:00Z');
  assert.equal(reedDateToIso('7/1/2026'), '2026-01-07T00:00:00Z');
  assert.equal(reedDateToIso('not-a-date'), undefined);
  assert.equal(reedDateToIso(undefined), undefined);
});

test('reedNotExpired: past expiry dropped, future/none kept', () => {
  const now = new Date('2026-07-07T00:00:00Z');
  assert.equal(reedNotExpired({ expirationDate: '01/07/2026' }, now), false); // past
  assert.equal(reedNotExpired({ expirationDate: '31/12/2026' }, now), true); // future
  assert.equal(reedNotExpired({ expirationDate: '07/07/2026' }, now), true); // today
  assert.equal(reedNotExpired({}, now), true); // no expiry
});

// --- D0: query construction helpers --------------------------------------

test('topRoles: caps at max, trims, drops empties', () => {
  const roles = topRoles(['  Data Analyst ', '', 'BI Developer', 'Analyst 3', 'Analyst 4']);
  assert.deepEqual(roles, ['Data Analyst', 'BI Developer', 'Analyst 3']); // default cap 3
});

test('extractCity: takes city segment, keeps bare country', () => {
  assert.equal(extractCity('London, United Kingdom'), 'London');
  assert.equal(extractCity('Manchester'), 'Manchester');
  assert.equal(extractCity('United Kingdom'), 'United Kingdom'); // bare country → nationwide
  assert.equal(extractCity('Leeds, England, UK'), 'Leeds');
});

// --- Relevance filter (Cách A) — AC2 table --------------------------------

test('filterByRoleRelevance: AC2 acceptance table', () => {
  const kept = (role: string, title: string) =>
    filterByRoleRelevance([{ title, url: 'https://x/1', snippet: '' }], [role]).length === 1;

  assert.equal(kept('Data Analyst', 'Senior Data Analyst'), true); // ✅ keep
  assert.equal(kept('Data Analyst', 'Data Administrator'), false); // ❌ no "analyst"
  assert.equal(kept('Data Analyst', 'Legal Technologist'), false); // ❌
  assert.equal(kept('Data Analyst', 'Head of Trading'), false); // ❌
  assert.equal(kept('Data Analyst', 'Data Analyst - Fintech'), true); // ✅ keep
  assert.equal(kept('BI Developer', 'Business Intelligence Developer'), false); // ⚠️ accepted drop
  assert.equal(kept('BI Developer', 'BI Developer (Power BI)'), true); // ✅ keep
});

test('filterByRoleRelevance: keeps a job matching ANY selected role', () => {
  const jobs: ExaJobListing[] = [
    { title: 'Head of Trading', url: 'https://x/1', snippet: '' }, // matches neither
    { title: 'Senior BI Developer', url: 'https://x/2', snippet: '' }, // matches "BI Developer"
  ];
  const out = filterByRoleRelevance(jobs, ['Data Analyst', 'BI Developer']);
  assert.deepEqual(out.map((j) => j.title), ['Senior BI Developer']);
});

test('filterByRoleRelevance: single-word role needs only the head token', () => {
  const jobs: ExaJobListing[] = [
    { title: 'Senior Accountant', url: 'https://x/1', snippet: '' },
    { title: 'Marketing Manager', url: 'https://x/2', snippet: '' },
  ];
  assert.deepEqual(filterByRoleRelevance(jobs, ['Accountant']).map((j) => j.title), ['Senior Accountant']);
});

test('filterByRoleRelevance: empty/whitespace role list is a no-op (keeps all)', () => {
  const jobs: ExaJobListing[] = [{ title: 'Anything', url: 'https://x/1', snippet: '' }];
  assert.equal(filterByRoleRelevance(jobs, []).length, 1);
  assert.equal(filterByRoleRelevance(jobs, ['   ']).length, 1);
});

test('normalizeTitleTokens: lowercases, strips punctuation and seniority/noise', () => {
  assert.deepEqual(normalizeTitleTokens('Senior Data Analyst (Fintech) II'), ['data', 'analyst', 'fintech']);
  assert.deepEqual(normalizeTitleTokens('Head of Trading'), ['trading']);
});

// --- D1/D2: freshness (never unfiltered, hard cap, drop undated) ----------

test('applyFreshness: drops jobs older than the window', () => {
  const now = new Date('2026-07-07T00:00:00Z');
  const jobs: ExaJobListing[] = [
    { title: 'fresh', url: 'a', snippet: '', publishedDate: '2026-07-04T00:00:00Z' }, // 3 days
    { title: 'stale', url: 'b', snippet: '', publishedDate: '2026-01-01T00:00:00Z' }, // ~187 days
  ];
  const out = applyFreshness(jobs, { now, maxDays: 7, minKeep: 1 });
  assert.equal(out.jobs.length, 1);
  assert.equal(out.jobs[0].title, 'fresh');
  assert.equal(out.sparse, false);
});

test('D1 AC: 3 fresh + 20 old, minKeep=8 → only the 3 fresh, NEVER the old ones', () => {
  const now = new Date('2026-07-07T00:00:00Z');
  const fresh: ExaJobListing[] = [0, 1, 2].map((i) => ({
    title: `fresh${i}`,
    url: `https://x/${i}`,
    snippet: '',
    publishedDate: '2026-07-05T00:00:00Z', // 2 days
  }));
  const old: ExaJobListing[] = Array.from({ length: 20 }, (_, i) => ({
    title: `old${i}`,
    url: `https://y/${i}`,
    snippet: '',
    publishedDate: '2026-04-01T00:00:00Z', // ~97 days — beyond hard cap
  }));
  const out = applyFreshness([...fresh, ...old], { now, maxDays: 7, hardCapDays: 30, minKeep: 8 });
  assert.equal(out.jobs.length, 3); // only the 3 fresh
  assert.ok(out.jobs.every((j) => j.title.startsWith('fresh')));
  assert.equal(out.sparse, true); // below minKeep → flagged
});

test('D1 AC: nothing older than the hard cap is ever returned', () => {
  const now = new Date('2026-07-07T00:00:00Z');
  const jobs: ExaJobListing[] = [
    { title: 'day40', url: 'a', snippet: '', publishedDate: '2026-05-28T00:00:00Z' }, // ~40 days
  ];
  const out = applyFreshness(jobs, { now, maxDays: 7, hardCapDays: 30, minKeep: 8 });
  assert.equal(out.jobs.length, 0); // 40 > 30 hard cap → excluded even though sparse
  assert.equal(out.sparse, true);
});

test('applyFreshness: undated jobs dropped by default, kept when dropUndated=false', () => {
  const now = new Date('2026-07-07T00:00:00Z');
  const jobs: ExaJobListing[] = [{ title: 'nodate', url: 'a', snippet: '' }];
  assert.equal(applyFreshness(jobs, { now, minKeep: 1 }).jobs.length, 0); // dropped
  assert.equal(applyFreshness(jobs, { now, minKeep: 1, dropUndated: false }).jobs.length, 1); // kept
});

// --- finalize ------------------------------------------------------------

test('finalizeJobs: sorts newest-first, drops url-less, caps', () => {
  const jobs: ExaJobListing[] = [
    { title: 'old', url: 'a', snippet: '', publishedDate: '2026-01-01T00:00:00Z' },
    { title: 'new', url: 'b', snippet: '', publishedDate: '2026-07-01T00:00:00Z' },
    { title: 'nourl', url: '', snippet: '', publishedDate: '2026-08-01T00:00:00Z' },
  ];
  const out = finalizeJobs(jobs, 2);
  assert.deepEqual(out.map((j) => j.title), ['new', 'old']);
});

test('dedupeJobs: same URL (query/trailing-slash ignored) collapses to one', () => {
  const jobs: ExaJobListing[] = [
    { title: 'Role A', url: 'https://x.com/jobs/1?utm=a', snippet: '' },
    { title: 'Role A dup', url: 'https://x.com/jobs/1/', snippet: '' },
    { title: 'Role B', url: 'https://x.com/jobs/2', snippet: '' },
  ];
  const out = dedupeJobs(jobs);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((j) => j.url), ['https://x.com/jobs/1?utm=a', 'https://x.com/jobs/2']);
});

test('dedupeJobs: identical title at different URLs is kept (distinct employers)', () => {
  const jobs: ExaJobListing[] = [
    { title: 'Data Analyst', url: 'https://a.com/1', snippet: '' },
    { title: 'Data Analyst', url: 'https://b.com/9', snippet: '' },
  ];
  assert.equal(dedupeJobs(jobs).length, 2);
});

test('finalizeJobs: dedupes duplicate URLs before capping', () => {
  const jobs: ExaJobListing[] = [
    { title: 'dup1', url: 'https://x.com/1', snippet: '', publishedDate: '2026-07-01T00:00:00Z' },
    { title: 'dup2', url: 'https://x.com/1', snippet: '', publishedDate: '2026-07-02T00:00:00Z' },
  ];
  assert.equal(finalizeJobs(jobs).length, 1);
});

// --- fallback chain (deterministic: all API keys unset) ------------------

function withNoKeys(mode: string, fn: () => Promise<void>): Promise<void> {
  const saved = {
    ADZUNA_APP_ID: process.env.ADZUNA_APP_ID,
    ADZUNA_APP_KEY: process.env.ADZUNA_APP_KEY,
    REED_API_KEY: process.env.REED_API_KEY,
    EXA_API_KEY: process.env.EXA_API_KEY,
    DREAM_JOB_SOURCE: process.env.DREAM_JOB_SOURCE,
  };
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
  delete process.env.REED_API_KEY;
  delete process.env.EXA_API_KEY;
  process.env.DREAM_JOB_SOURCE = mode;
  return fn().finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('D3: UK with all sources down → AAT-10, source=uk (NEVER falls back to Exa)', async () => {
  await withNoKeys('hybrid', async () => {
    const res = await searchLiveJobs({ roleTitles: ['Data Analyst'], location: 'London, UK' });
    assert.deepEqual(res.jobs, []);
    assert.equal(res.error, JOBS_UNAVAILABLE_ERROR);
    assert.equal(res.meta?.source, 'uk'); // proves it did NOT route/fall back to exa
  });
});

test('Issue 1: hybrid uncovered region (VN) → empty + notice, NOT error, NOT Exa', async () => {
  await withNoKeys('hybrid', async () => {
    const res = await searchLiveJobs({ roleTitles: ['Engineer'], location: 'Hanoi, Vietnam' });
    assert.deepEqual(res.jobs, []);
    assert.equal(res.error, null); // benign, roadmap still valid
    assert.match(res.notice ?? '', /Hanoi, Vietnam/); // region interpolated
    assert.equal(res.meta?.source, 'unsupported'); // proves NO Exa fallback
  });
});

test('Issue 1: Hong Kong → empty + region notice (the reported bug)', async () => {
  await withNoKeys('hybrid', async () => {
    const res = await searchLiveJobs({ roleTitles: ['Data Analyst'], location: 'Hong Kong' });
    assert.deepEqual(res.jobs, []);
    assert.equal(res.error, null);
    assert.match(res.notice ?? '', /Hong Kong/);
    assert.equal(res.meta?.source, 'unsupported');
  });
});

test('Issue 1: adzuna_reed strict mode outside coverage → notice too (no Exa)', async () => {
  await withNoKeys('adzuna_reed', async () => {
    const res = await searchLiveJobs({ roleTitles: ['Engineer'], location: 'Hanoi, Vietnam' });
    assert.deepEqual(res.jobs, []);
    assert.equal(res.error, null);
    assert.equal(res.meta?.source, 'unsupported');
  });
});

test('AC4: DREAM_JOB_SOURCE=exa still routes to Exa for any location (legacy/debug)', () => {
  assert.deepEqual(routeLocation('Hong Kong', 'exa'), { kind: 'exa' });
  assert.deepEqual(routeLocation('Hanoi, Vietnam', 'exa'), { kind: 'exa' });
});
