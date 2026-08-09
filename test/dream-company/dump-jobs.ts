/**
 * Dump the REAL job listings the merged orchestrator returns, so we can crawl the URLs
 * and verify job quality. Same code + keys as production → same output.
 *   npx tsx test/dream-company/dump-jobs.ts
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
process.env.JOB_LIVENESS_ENABLED = 'true';

const SEARCHES = [
  { roleTitles: ['Marketing Manager'], location: 'London, United Kingdom' },
  { roleTitles: ['Data Analyst'], location: 'Manchester, United Kingdom' },
];

async function main(): Promise<void> {
  const out: unknown[] = [];
  for (const s of SEARCHES) {
    clearJobCache();
    const { jobs, meta } = await searchLiveJobs(s);
    out.push({
      search: `${s.roleTitles[0]} @ ${s.location}`,
      meta,
      jobs: jobs.map((j) => ({ title: j.title, url: j.url, publishedDate: j.publishedDate, snippet: j.snippet })),
    });
  }
  writeFileSync(resolve(__dirname, 'dump-jobs.json'), JSON.stringify(out, null, 2));
  console.log('wrote dump-jobs.json');
  // Print a compact table for quick inspection.
  for (const grp of out as Array<{ search: string; jobs: Array<{ title: string; url: string; publishedDate?: string }> }>) {
    console.log(`\n### ${grp.search} (${grp.jobs.length} jobs)`);
    grp.jobs.slice(0, 8).forEach((j, i) => {
      const age = j.publishedDate ? `${((Date.now() - Date.parse(j.publishedDate)) / 86400000).toFixed(1)}d` : 'no-date';
      console.log(`${String(i + 1).padStart(2)}. [${age}] ${j.title.slice(0, 45).padEnd(45)} ${j.url}`);
    });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
