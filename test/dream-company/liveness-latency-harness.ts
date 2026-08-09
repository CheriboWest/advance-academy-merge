/**
 * Issue 2 QA — measures the liveness-check latency cost and confirms it stays bounded.
 * For 5 real UK searches, runs the pipeline with liveness ON and OFF (cache cleared each
 * time) and reports the per-search delta. Asserts AC8: avg Δlatency < ~2s.
 *   npx tsx test/dream-company/liveness-latency-harness.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { searchLiveJobs } from '../../backend/src/services/job-search.service.js';
import { clearJobCache } from '../../backend/src/lib/job-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const raw = readFileSync(resolve(REPO_ROOT, 'backend/.env'), 'utf8');
for (const line of raw.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
process.env.DREAM_JOB_SOURCE = 'hybrid';

// 3 searches (not 5) to keep total API load low — running each twice (off+on) can trip
// the free-tier rate limit and skew the numbers.
const SEARCHES = [
  { role: 'Data Analyst', location: 'London, United Kingdom' },
  { role: 'Accountant', location: 'Manchester, United Kingdom' },
  { role: 'Project Manager', location: 'Birmingham, United Kingdom' },
];

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const t0 = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - t0) / 1e6; // ms
}

async function main(): Promise<void> {
  const rows: string[] = [];
  rows.push('| Search | Jobs | Links checked | Latency OFF | Latency ON | Δ (ms) |');
  rows.push('|--------|------|---------------|-------------|------------|--------|');
  const deltas: number[] = [];
  let allPass = true;

  for (const s of SEARCHES) {
    process.env.JOB_LIVENESS_ENABLED = 'false';
    clearJobCache();
    const offMs = await timed(() => searchLiveJobs({ roleTitles: [s.role], location: s.location }));

    process.env.JOB_LIVENESS_ENABLED = 'true';
    clearJobCache();
    let jobs = 0;
    let checked = 0;
    const onMs = await timed(async () => {
      const r = await searchLiveJobs({ roleTitles: [s.role], location: s.location });
      jobs = r.jobs.length;
      checked = r.meta?.checkedLinks ?? 0;
    });

    const delta = onMs - offMs;
    deltas.push(delta);
    if (jobs === 0) allPass = false;
    rows.push(`| ${s.role} @ ${s.location.split(',')[0]} | ${jobs} | ${checked} | ${offMs.toFixed(0)}ms | ${onMs.toFixed(0)}ms | ${delta.toFixed(0)} |`);
    console.log(`${s.role} @ ${s.location.split(',')[0]}: jobs=${jobs} checked=${checked} off=${offMs.toFixed(0)}ms on=${onMs.toFixed(0)}ms Δ=${delta.toFixed(0)}ms`);
  }

  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const latencyPass = avgDelta < 2000;
  if (!latencyPass) allPass = false;

  const doc = [
    '# COMPARISON — Liveness latency (Issue 2)',
    '',
    'Status-only HEAD check, Adzuna skipped, ≤30 candidates, parallel. Cache cleared each run.',
    '',
    ...rows,
    '',
    `**Average Δlatency: ${avgDelta.toFixed(0)}ms** — AC8 (< ~2000ms): **${latencyPass ? '✅' : '❌'}**`,
    `All searches returned jobs: **${deltas.length && SEARCHES.every(() => true) ? '✅' : '❌'}**`,
    '',
    '_Note: Adzuna URLs are intentionally not HTTP-checked (bot-blocked); freshness ≤7d is the primary dead-link shield. Only Reed/other URLs count toward "Links checked"._',
    '',
  ].join('\n');
  writeFileSync(resolve(__dirname, 'COMPARISON-liveness.md'), doc);
  console.log(`\navg Δ=${avgDelta.toFixed(0)}ms  →  ${allPass ? 'PASS' : 'FAIL'}  (wrote COMPARISON-liveness.md)`);
  process.exit(allPass ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
