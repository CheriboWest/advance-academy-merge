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

test('routeLocation: outside coverage → exa (D3 fallback)', () => {
  assert.deepEqual(routeLocation('Hanoi, Vietnam', 'hybrid'), { kind: 'exa' });
  assert.deepEqual(routeLocation('Ho Chi Minh City', 'hybrid'), { kind: 'exa' });
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

// --- freshness -----------------------------------------------------------

test('applyFreshness: drops jobs older than maxDays', () => {
  const now = new Date('2026-07-07T00:00:00Z');
  const jobs: ExaJobListing[] = [
    { title: 'fresh', url: 'a', snippet: '', publishedDate: '2026-07-01T00:00:00Z' }, // 6 days
    { title: 'stale', url: 'b', snippet: '', publishedDate: '2026-01-01T00:00:00Z' }, // ~187 days
  ];
  const out = applyFreshness(jobs, { now, minKeep: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'fresh');
});

test('applyFreshness: abandons filter when result would fall below minKeep', () => {
  const now = new Date('2026-07-07T00:00:00Z');
  const jobs: ExaJobListing[] = [
    { title: 'fresh', url: 'a', snippet: '', publishedDate: '2026-07-01T00:00:00Z' },
    { title: 'stale', url: 'b', snippet: '', publishedDate: '2026-01-01T00:00:00Z' },
  ];
  const out = applyFreshness(jobs, { now, minKeep: 2 });
  assert.equal(out.length, 2); // filter abandoned → both kept
});

test('applyFreshness: keeps jobs with missing/invalid publishedDate', () => {
  const now = new Date('2026-07-07T00:00:00Z');
  const jobs: ExaJobListing[] = [{ title: 'nodate', url: 'a', snippet: '' }];
  assert.equal(applyFreshness(jobs, { now, minKeep: 1 }).length, 1);
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

test('searchLiveJobs: UK with all sources down → AAT-10, never throws', async () => {
  await withNoKeys('hybrid', async () => {
    const res = await searchLiveJobs({ roleTitles: ['Data Analyst'], location: 'London, UK' });
    assert.deepEqual(res, { jobs: [], error: JOBS_UNAVAILABLE_ERROR });
  });
});

test('searchLiveJobs: hybrid VN routes to Exa; Exa down → AAT-10', async () => {
  await withNoKeys('hybrid', async () => {
    const res = await searchLiveJobs({ roleTitles: ['Engineer'], location: 'Hanoi, Vietnam' });
    assert.deepEqual(res, { jobs: [], error: JOBS_UNAVAILABLE_ERROR });
  });
});

test('searchLiveJobs: adzuna_reed strict mode outside coverage → AAT-10, no Exa', async () => {
  await withNoKeys('adzuna_reed', async () => {
    const res = await searchLiveJobs({ roleTitles: ['Engineer'], location: 'Hanoi, Vietnam' });
    assert.deepEqual(res, { jobs: [], error: JOBS_UNAVAILABLE_ERROR });
  });
});
