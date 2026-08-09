/**
 * JS-7 — Live-vacancy job-source acceptance harness.
 *
 * Drives the orchestrator (searchLiveJobs) directly across a 13-case set and grades the
 * work-order success metrics against roadmap.jobs:
 *   - ≥90% of jobs have publishedDate ≤ 45 days old
 *   - 100% of job URLs are syntactically valid
 *   - 0 LinkedIn "/in/" profile URLs
 * Plus: 1 UK profile compared Exa-vs-hybrid (freshness + %real-job-links), and 1 VN
 * profile to confirm the Exa fallback fires. Writes COMPARISON-jobsource.md.
 *
 * Runs the code path directly (no LLM tokens, no HTTP/auth) so it's cheap to repeat.
 *
 * Usage (from repo root, needs ADZUNA_APP_ID/KEY, REED_API_KEY, EXA_API_KEY in backend/.env):
 *   npx tsx test/dream-company/jobsource-harness.ts
 *
 * Reads backend/.env itself (no dotenv dependency).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// Static imports are safe: config/job-source and the source clients read env lazily
// (at call time), so loadEnv() below runs before searchLiveJobs() is ever invoked.
import { searchLiveJobs } from '../../backend/src/services/job-search.service.js';
import { clearJobCache } from '../../backend/src/lib/job-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

// --- load backend/.env into process.env (minimal parser) -----------------
function loadEnv(): void {
  const envPath = resolve(REPO_ROOT, 'backend/.env');
  let raw = '';
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    console.error(`[harness] Could not read ${envPath} — set ADZUNA/REED/EXA keys there first.`);
    process.exit(1);
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k] === undefined) process.env[k] = v.replace(/^["']|["']$/g, '');
  }
}
loadEnv();

interface Case {
  id: string;
  roleTitles: string[];
  location: string;
  expectRoute: 'uk' | 'adzuna' | 'exa';
}

// 13-case set — UK-weighted (primary market) + covered-country + outside-coverage.
const CASES: Case[] = [
  { id: 'JS-01', roleTitles: ['Data Analyst'], location: 'London, UK', expectRoute: 'uk' },
  { id: 'JS-02', roleTitles: ['Software Engineer'], location: 'Manchester, England', expectRoute: 'uk' },
  { id: 'JS-03', roleTitles: ['Product Manager'], location: 'Birmingham, UK', expectRoute: 'uk' },
  { id: 'JS-04', roleTitles: ['Marketing Executive'], location: 'Edinburgh, Scotland', expectRoute: 'uk' },
  { id: 'JS-05', roleTitles: ['Financial Analyst'], location: 'Leeds, UK', expectRoute: 'uk' },
  { id: 'JS-06', roleTitles: ['UX Designer'], location: 'Bristol, UK', expectRoute: 'uk' },
  { id: 'JS-07', roleTitles: ['Project Manager'], location: 'Glasgow, UK', expectRoute: 'uk' },
  { id: 'JS-08', roleTitles: ['Business Analyst'], location: 'Cardiff, Wales', expectRoute: 'uk' },
  { id: 'JS-09', roleTitles: ['DevOps Engineer'], location: 'Liverpool, UK', expectRoute: 'uk' },
  { id: 'JS-10', roleTitles: ['HR Manager'], location: 'United Kingdom', expectRoute: 'uk' },
  { id: 'JS-11', roleTitles: ['Data Scientist'], location: 'New York, United States', expectRoute: 'adzuna' },
  { id: 'JS-12', roleTitles: ['Software Engineer'], location: 'Sydney, Australia', expectRoute: 'adzuna' },
  { id: 'JS-13', roleTitles: ['Product Manager'], location: 'Ho Chi Minh City, Vietnam', expectRoute: 'exa' },
];

const DAY_MS = 86_400_000;

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function ageDays(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (Date.now() - t) / DAY_MS;
}

interface Metrics {
  total: number;
  freshPct: number; // % with age ≤ 45d (dated jobs only; undated counted as not-fresh for a strict read)
  validUrlPct: number;
  linkedInProfileCount: number;
}

function computeMetrics(jobs: Array<{ url: string; publishedDate?: string }>): Metrics {
  const total = jobs.length;
  if (total === 0) return { total: 0, freshPct: 0, validUrlPct: 0, linkedInProfileCount: 0 };
  let fresh = 0;
  let validUrls = 0;
  let inProfiles = 0;
  for (const j of jobs) {
    const age = ageDays(j.publishedDate);
    if (age !== null && age <= 45) fresh++;
    if (isValidUrl(j.url)) validUrls++;
    if (/\/in\//i.test(j.url)) inProfiles++;
  }
  return {
    total,
    freshPct: (fresh / total) * 100,
    validUrlPct: (validUrls / total) * 100,
    linkedInProfileCount: inProfiles,
  };
}

function realJobLinkPct(jobs: Array<{ url: string }>): number {
  if (jobs.length === 0) return 0;
  const real = jobs.filter((j) => isValidUrl(j.url) && !/\/in\//i.test(j.url)).length;
  return (real / jobs.length) * 100;
}

async function main(): Promise<void> {
  console.log(`[harness] DREAM_JOB_SOURCE=${process.env.DREAM_JOB_SOURCE ?? '(unset→hybrid)'}\n`);

  const allJobs: Array<{ url: string; publishedDate?: string }> = [];
  const rows: string[] = [];
  rows.push('| Case | Location | Jobs | Fresh ≤45d | Valid URL | /in/ |');
  rows.push('|------|----------|------|-----------|-----------|------|');

  for (const c of CASES) {
    clearJobCache();
    const { jobs, error } = await searchLiveJobs({ roleTitles: c.roleTitles, location: c.location });
    const m = computeMetrics(jobs);
    allJobs.push(...jobs);
    const note = error ? ` (error: ${error.slice(0, 30)}…)` : '';
    rows.push(
      `| ${c.id} | ${c.location} | ${m.total} | ${m.freshPct.toFixed(0)}% | ${m.validUrlPct.toFixed(0)}% | ${m.linkedInProfileCount} |${note}`,
    );
    console.log(`${c.id} ${c.location} → ${m.total} jobs, fresh ${m.freshPct.toFixed(0)}%, /in/ ${m.linkedInProfileCount}${note}`);
  }

  const overall = computeMetrics(allJobs);
  const pass = {
    fresh: overall.freshPct >= 90,
    url: overall.validUrlPct >= 100,
    noProfiles: overall.linkedInProfileCount === 0,
  };

  // --- UK Exa-vs-hybrid comparison (JS-07 role) --------------------------
  const ukCase = { roleTitles: ['Software Engineer'], location: 'London, UK' };
  clearJobCache();
  process.env.DREAM_JOB_SOURCE = 'exa';
  const exaRun = await searchLiveJobs(ukCase);
  clearJobCache();
  process.env.DREAM_JOB_SOURCE = 'hybrid';
  const hybridRun = await searchLiveJobs(ukCase);
  const exaMetrics = computeMetrics(exaRun.jobs);
  const hybridMetrics = computeMetrics(hybridRun.jobs);

  // --- VN fallback confirmation (JS-13) ----------------------------------
  clearJobCache();
  const vnRun = await searchLiveJobs({ roleTitles: ['Product Manager'], location: 'Ho Chi Minh City, Vietnam' });

  const summary = [
    '# COMPARISON — Live Job Source (Adzuna + Reed) vs Exa',
    '',
    `_Generated by \`test/dream-company/jobsource-harness.ts\`. Run date is machine-local._`,
    '',
    '## Success metrics (13-case hybrid, aggregate)',
    '',
    `| Metric | Target | Actual | Verdict |`,
    `|--------|--------|--------|---------|`,
    `| Jobs ≤ 45 days | ≥90% | ${overall.freshPct.toFixed(1)}% | ${pass.fresh ? '✅' : '❌'} |`,
    `| Valid URLs | 100% | ${overall.validUrlPct.toFixed(1)}% | ${pass.url ? '✅' : '❌'} |`,
    `| LinkedIn /in/ profiles | 0 | ${overall.linkedInProfileCount} | ${pass.noProfiles ? '✅' : '❌'} |`,
    '',
    '## Per-case',
    '',
    ...rows,
    '',
    '## UK: Exa vs Hybrid (role: Software Engineer, London)',
    '',
    `| Source | Jobs | Fresh ≤45d | Real job links (non-/in/) |`,
    `|--------|------|-----------|---------------------------|`,
    `| Exa (legacy) | ${exaMetrics.total} | ${exaMetrics.freshPct.toFixed(0)}% | ${realJobLinkPct(exaRun.jobs).toFixed(0)}% |`,
    `| Hybrid (Adzuna+Reed) | ${hybridMetrics.total} | ${hybridMetrics.freshPct.toFixed(0)}% | ${realJobLinkPct(hybridRun.jobs).toFixed(0)}% |`,
    '',
    '## VN fallback (role: Product Manager, Ho Chi Minh City)',
    '',
    `- jobs returned: ${vnRun.jobs.length}`,
    `- error state: ${vnRun.error ?? 'none'}`,
    `- expectation: routed to Exa fallback (no regression outside UK) — ${vnRun.jobs.length > 0 || vnRun.error ? '✅ handled' : '❌ empty & no error'}`,
    '',
  ].join('\n');

  const outPath = resolve(__dirname, 'COMPARISON-jobsource.md');
  writeFileSync(outPath, summary);
  console.log(`\n[harness] Wrote ${outPath}`);

  console.log('\n=== ACCEPTANCE ===');
  console.log(`Fresh ≥90%:      ${pass.fresh ? 'PASS' : 'FAIL'} (${overall.freshPct.toFixed(1)}%)`);
  console.log(`Valid URL 100%:  ${pass.url ? 'PASS' : 'FAIL'} (${overall.validUrlPct.toFixed(1)}%)`);
  console.log(`0 /in/ profiles: ${pass.noProfiles ? 'PASS' : 'FAIL'} (${overall.linkedInProfileCount})`);

  const allPass = pass.fresh && pass.url && pass.noProfiles;
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('[harness] fatal:', err);
  process.exit(1);
});
