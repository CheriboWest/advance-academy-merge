/**
 * QA harness for the Dream Company "outdated jobs" fix (D0–D6).
 *
 * Runs ≥5 real UK searches through the orchestrator and asserts Violet's criteria:
 *   - 100% of jobs have publishedDate within the hard-cap window (default 30 days)
 *   - 0 undated jobs
 *   - 0 jobs sourced from Exa for UK profiles (meta.source === 'uk')
 *   - jobs sorted newest → oldest
 *   - live-link rate ≥ 95% (independent HTTP re-check for the report)
 * Writes COMPARISON-jobsource-fix.md.
 *
 * Makes LIVE Adzuna/Reed calls — run deliberately with keys in backend/.env:
 *   npx tsx test/dream-company/jobsource-fix-harness.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { searchLiveJobs } from '../../backend/src/services/job-search.service.js';
import { filterLiveJobs } from '../../backend/src/lib/job-liveness.js';
import { clearJobCache } from '../../backend/src/lib/job-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function loadEnv(): void {
  const raw = (() => {
    try {
      return readFileSync(resolve(REPO_ROOT, 'backend/.env'), 'utf8');
    } catch {
      console.error('[qa] backend/.env not found — need ADZUNA/REED/EXA keys.');
      process.exit(1);
    }
  })();
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  process.env.DREAM_JOB_SOURCE = 'hybrid';
  process.env.JOB_LIVENESS_ENABLED = 'true';
}
loadEnv();

const HARD_CAP_DAYS = Number(process.env.JOB_FRESHNESS_HARD_CAP_DAYS ?? '30');
const DAY_MS = 86_400_000;

const SEARCHES = [
  { roleTitles: ['Marketing Manager'], location: 'London, United Kingdom' },
  { roleTitles: ['Data Analyst'], location: 'Manchester, United Kingdom' },
  { roleTitles: ['Software Engineer'], location: 'London, United Kingdom' },
  { roleTitles: ['Accountant'], location: 'Leeds, United Kingdom' },
  { roleTitles: ['Designer'], location: 'Remote, United Kingdom' },
];

function ageDays(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (Date.now() - t) / DAY_MS;
}

async function main(): Promise<void> {
  const rows: string[] = [];
  rows.push('| Search | Location | Source | Jobs | Age min–max (d) | Undated | Older than cap | Live links |');
  rows.push('|--------|----------|--------|------|-----------------|---------|----------------|-----------|');

  let allPass = true;
  const failures: string[] = [];

  for (const s of SEARCHES) {
    clearJobCache();
    const { jobs, error, meta } = await searchLiveJobs(s);
    const ages = jobs.map((j) => ageDays(j.publishedDate));
    const undated = ages.filter((a) => a === null).length;
    const overCap = ages.filter((a) => a !== null && a > HARD_CAP_DAYS).length;
    const dated = ages.filter((a): a is number => a !== null);
    const minA = dated.length ? Math.min(...dated).toFixed(1) : '-';
    const maxA = dated.length ? Math.max(...dated).toFixed(1) : '-';
    const sortedOk = jobs.every((j, i) => i === 0 || (Date.parse(jobs[i - 1].publishedDate ?? '0') >= Date.parse(j.publishedDate ?? '0')));

    // Independent live-link re-check for reporting.
    const liveRes = await filterLiveJobs(jobs, { timeoutMs: 5000 });
    const livePct = jobs.length ? (liveRes.live.length / jobs.length) * 100 : 100;

    // Assertions
    const label = `${s.roleTitles[0]} @ ${s.location}`;
    if (meta?.source === 'exa') { allPass = false; failures.push(`${label}: source=exa (UK should never use Exa)`); }
    if (undated > 0) { allPass = false; failures.push(`${label}: ${undated} undated job(s)`); }
    if (overCap > 0) { allPass = false; failures.push(`${label}: ${overCap} job(s) older than ${HARD_CAP_DAYS}d`); }
    if (!sortedOk) { allPass = false; failures.push(`${label}: not sorted newest→oldest`); }
    if (jobs.length > 0 && livePct < 95) { allPass = false; failures.push(`${label}: only ${livePct.toFixed(0)}% live links`); }

    rows.push(
      `| ${s.roleTitles[0]} | ${s.location.split(',')[0]} | ${meta?.source ?? '-'} | ${jobs.length} | ${minA}–${maxA} | ${undated} | ${overCap} | ${livePct.toFixed(0)}% |`,
    );
    console.log(
      `${label} → source=${meta?.source} jobs=${jobs.length} window=${meta?.windowDaysUsed}d sparse=${meta?.sparse} undated=${undated} overCap=${overCap} live=${livePct.toFixed(0)}%${error ? ` error="${error.slice(0, 30)}…"` : ''}`,
    );
  }

  const doc = [
    '# COMPARISON — Dream Company job-source fix (D0–D6)',
    '',
    `Hard-cap window: **${HARD_CAP_DAYS} days**. Mode: hybrid. Run against live Adzuna/Reed.`,
    '',
    '## Per-search results',
    '',
    ...rows,
    '',
    '## Acceptance',
    '',
    `- 0 jobs sourced from Exa for UK profiles: **${failures.some((f) => f.includes('source=exa')) ? '❌' : '✅'}**`,
    `- 0 undated jobs: **${failures.some((f) => f.includes('undated')) ? '❌' : '✅'}**`,
    `- 0 jobs older than the hard cap: **${failures.some((f) => f.includes('older than')) ? '❌' : '✅'}**`,
    `- Sorted newest→oldest: **${failures.some((f) => f.includes('sorted')) ? '❌' : '✅'}**`,
    `- Live links ≥95%: **${failures.some((f) => f.includes('live links')) ? '❌' : '✅'}**`,
    '',
    failures.length ? `### Failures\n\n${failures.map((f) => `- ${f}`).join('\n')}` : '_All assertions passed._',
    '',
  ].join('\n');

  const outPath = resolve(__dirname, 'COMPARISON-jobsource-fix.md');
  writeFileSync(outPath, doc);
  console.log(`\n[qa] Wrote ${outPath}`);
  console.log(`\n=== ${allPass ? 'PASS' : 'FAIL'} ===`);
  if (!allPass) failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('[qa] fatal:', err);
  process.exit(1);
});
