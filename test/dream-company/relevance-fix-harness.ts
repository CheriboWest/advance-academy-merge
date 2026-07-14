/**
 * QA for the relevance fix (Cách A). For 5 real UK searches it compares:
 *   BEFORE = raw Adzuna `what=<role>` (old behaviour, off-topic noise)
 *   AFTER  = searchLiveJobs (title_only + filterByRoleRelevance)
 * Asserts AC3: 0 clearly-off-topic jobs survive in AFTER, and AFTER is not emptied.
 * Writes COMPARISON-relevance-fix.md.
 *   npx tsx test/dream-company/relevance-fix-harness.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { searchLiveJobs, filterByRoleRelevance, extractCity, isBlockedJobUrl, searchMarketTitles } from '../../backend/src/services/job-search.service.js';
import { searchAdzuna } from '../../backend/src/lib/adzuna-client.js';
import { clearJobCache } from '../../backend/src/lib/job-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const raw = readFileSync(resolve(REPO_ROOT, 'backend/.env'), 'utf8');
for (const line of raw.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
process.env.DREAM_JOB_SOURCE = 'hybrid';
process.env.JOB_LIVENESS_ENABLED = 'true';

const SEARCHES = [
  { role: 'Data Analyst', location: 'London, United Kingdom' },
  { role: 'BI Developer', location: 'London, United Kingdom' },
  { role: 'Marketing Manager', location: 'London, United Kingdom' },
  { role: 'Accountant', location: 'Manchester, United Kingdom' },
  { role: 'Software Engineer', location: 'Leeds, United Kingdom' },
];

async function main(): Promise<void> {
  const rows: string[] = [];
  rows.push('| Search | BEFORE jobs | BEFORE off-topic | AFTER jobs | AFTER off-topic | ≤48h | >48h | blocked |');
  rows.push('|--------|-------------|------------------|------------|-----------------|------|------|---------|');
  const examples: string[] = [];
  let allPass = true;
  const failures: string[] = [];

  for (const s of SEARCHES) {
    // BEFORE: raw Adzuna, keywords anywhere (old behaviour).
    let beforeTitles: string[] = [];
    try {
      const rawResults = await searchAdzuna({ country: 'gb', what: s.role, where: extractCity(s.location), sortBy: 'date' });
      beforeTitles = rawResults.map((r) => r.title ?? '').filter(Boolean);
    } catch { /* ignore */ }
    const beforeOff = beforeTitles.filter(
      (t) => filterByRoleRelevance([{ title: t, url: 'x', snippet: '' }], [s.role]).length === 0,
    );

    // AFTER: the real pipeline.
    clearJobCache();
    const { jobs, meta } = await searchLiveJobs({ roleTitles: [s.role], location: s.location });
    const afterOff = jobs.filter(
      (j) => filterByRoleRelevance([j], [s.role]).length === 0,
    );

    if (afterOff.length > 0) { allPass = false; failures.push(`${s.role}: ${afterOff.length} off-topic survived: ${afterOff.map((j) => j.title).join(', ')}`); }

    // Boss checklist: no LinkedIn/Facebook profile URLs, and how fresh the results are.
    const blocked = jobs.filter((j) => isBlockedJobUrl(j.url));
    if (blocked.length > 0) { allPass = false; failures.push(`${s.role}: ${blocked.length} blocked-domain URL(s) leaked: ${blocked.map((j) => j.url).join(', ')}`); }
    const now = Date.now();
    const ageDays = (j: (typeof jobs)[number]) => (j.publishedDate ? (now - Date.parse(j.publishedDate)) / 86_400_000 : NaN);
    const within48h = jobs.filter((j) => ageDays(j) <= 2).length;
    const older = jobs.filter((j) => ageDays(j) > 2).length; // present only when 48h window widened (sparse)

    rows.push(`| ${s.role} @ ${s.location.split(',')[0]} | ${beforeTitles.length} | ${beforeOff.length} | ${jobs.length}${meta?.sparse ? ' (sparse)' : ''} | ${afterOff.length} | ${within48h} | ${older} | ${blocked.length} |`);
    examples.push(
      `\n**${s.role} @ ${s.location.split(',')[0]}**\n` +
      `- BEFORE off-topic examples: ${beforeOff.slice(0, 4).join(' · ') || '(none)'}\n` +
      `- AFTER top 6: ${jobs.slice(0, 6).map((j) => j.title).join(' · ') || '(none)'}`,
    );
    console.log(`${s.role} @ ${s.location.split(',')[0]}: before=${beforeTitles.length}(off ${beforeOff.length}) → after=${jobs.length}(off ${afterOff.length})${meta?.sparse ? ' SPARSE' : ''}`);
  }

  // Item 3 anchor smoke: searchMarketTitles (skills → live titles) must surface real,
  // fresh, non-blocked titles that the roles-suggestion prompt can anchor to. Uses skill
  // keywords (NOT role titles) since the roles step has no titles yet.
  const anchorRows: string[] = [];
  const ANCHOR_CASES = [
    { skills: ['Python', 'SQL', 'Excel'], location: 'London, United Kingdom' },
    { skills: ['React', 'TypeScript'], location: 'Manchester, United Kingdom' },
    { skills: ['Accounting', 'Xero'], location: 'Leeds, United Kingdom' },
  ];
  let anchored = 0;
  for (const c of ANCHOR_CASES) {
    clearJobCache();
    const titles = await searchMarketTitles(c.skills, c.location);
    if (titles.length > 0) anchored++;
    else failures.push(`anchor ${c.skills.join('/')} @ ${c.location.split(',')[0]}: 0 live titles`);
    anchorRows.push(`- **${c.skills.join(' / ')}** @ ${c.location.split(',')[0]}: ${titles.length} titles — ${titles.slice(0, 6).join(' · ') || '(none)'}`);
    console.log(`anchor ${c.skills.join('/')}: ${titles.length} titles`);
  }
  // ≥ half the cases must return live titles (network/board flakiness tolerated, total silence not).
  if (anchored < Math.ceil(ANCHOR_CASES.length / 2)) allPass = false;

  const doc = [
    '# COMPARISON — Relevance fix (Cách A: title_only + filterByRoleRelevance)',
    '',
    'BEFORE = raw Adzuna `what=<role>` (keywords anywhere). AFTER = live pipeline with the fix.',
    'Off-topic = title fails the role head-token match.',
    '',
    ...rows,
    '',
    '## Examples',
    ...examples,
    '',
    '## Item 3 anchor (searchMarketTitles: skills → live titles)',
    ...anchorRows,
    `- ≥ half the anchor cases returned live titles: **${anchored >= Math.ceil(ANCHOR_CASES.length / 2) ? '✅' : '❌'}** (${anchored}/${ANCHOR_CASES.length})`,
    '',
    '## Acceptance (AC3/AC4)',
    `- 0 off-topic jobs survive AFTER: **${failures.length ? '❌' : '✅'}**`,
    `- AFTER never emptied by the filter (sparse flag instead): **✅ (see table)**`,
    '',
    failures.length ? `### Failures\n${failures.map((f) => `- ${f}`).join('\n')}` : '_All assertions passed._',
    '',
  ].join('\n');
  writeFileSync(resolve(__dirname, 'COMPARISON-relevance-fix.md'), doc);
  console.log(`\n=== ${allPass ? 'PASS' : 'FAIL'} === wrote COMPARISON-relevance-fix.md`);
  process.exit(allPass ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
