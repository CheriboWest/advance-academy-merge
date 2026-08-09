#!/usr/bin/env tsx
/**
 * Run the company-research pipeline from the command line (ticket T3).
 *
 * Usage (from the repo root or backend/):
 *   npm run research:company --workspace backend -- "Monzo Bank"
 *   npm run research:company --workspace backend -- "Monzo Bank" https://monzo.com
 *
 * There is deliberately no HTTP route yet — the orchestrator (T4) is what will
 * call this service, and shipping a route before then would be an untested
 * surface nobody uses. This script is how the pipeline gets exercised in the
 * meantime, by a human and by whoever is changing the prompt.
 *
 * It makes real calls: two Exa searches, one Jina fetch per URL, and one Sonnet
 * synthesis. Roughly two cents a run, logged to cost-log.jsonl like any other.
 *
 * Read the CITED / DROPPED counts first. Dropped claims are the model reaching
 * past its sources, which is the number worth watching after any prompt edit.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
// Safe as static imports: every config read happens lazily inside the call.
import { researchCompany } from '../src/services/company-research.service.js';
import { isCompaniesHouseConfigured } from '../src/lib/companies-house.js';

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'backend/.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile?.(candidate);
    break;
  }
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const companyName = args[0];
const companyUrl = args.find((a) => a.startsWith('http'));

function heading(text: string) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

function printFacts(label: string, facts: { claim: string; sourceUrl: string }[]) {
  heading(`${label} (${facts.length})`);
  if (facts.length === 0) {
    console.log('  (nothing the sources supported)');
    return;
  }
  for (const f of facts) {
    console.log(`  • ${f.claim}`);
    console.log(`    \x1b[2m↳ ${f.sourceUrl}\x1b[0m`);
  }
}

async function main() {
  if (!companyName) {
    console.error('Usage: npm run research:company --workspace backend -- "<company>" [url]');
    process.exit(1);
  }
  if (!process.env.EXA_API_KEY?.trim()) {
    console.error('✗ EXA_API_KEY is not set in backend/.env — web search will find nothing.');
  }
  if (!isCompaniesHouseConfigured()) {
    console.error(
      'ℹ COMPANIES_HOUSE_API_KEY is not set — registry facts will be skipped (optional).',
    );
  }

  console.log(`\nResearching "${companyName}"${companyUrl ? ` (${companyUrl})` : ''}…`);
  const startedAt = Date.now();

  const brief = await researchCompany({ companyName, companyUrl });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const cited =
    brief.overview.length +
    brief.products.length +
    brief.recentActivity.length +
    brief.culture.length;

  heading('RESULT');
  console.log(`  company   ${brief.companyName}`);
  console.log(`  sparse    ${brief.sparse ? '\x1b[33mYES\x1b[0m' : 'no'}`);
  console.log(`  sources   ${brief.sources.length}`);
  console.log(`  cited     ${cited} claim(s)`);
  console.log(`  took      ${elapsed}s`);

  if (brief.sparseReasons.length > 0) {
    heading('WHY IT IS THIN');
    for (const r of brief.sparseReasons) console.log(`  ! ${r}`);
  }

  if (brief.registry) {
    heading('COMPANIES HOUSE');
    console.log(`  ${brief.registry.companyName} (${brief.registry.companyNumber})`);
    console.log(`  status ${brief.registry.companyStatus} · incorporated ${brief.registry.dateOfCreation}`);
    console.log(`  ${brief.registry.registeredAddress ?? '—'}`);
  }

  printFacts('OVERVIEW', brief.overview);
  printFacts('PRODUCTS', brief.products);
  printFacts('RECENT ACTIVITY', brief.recentActivity);
  printFacts('CULTURE', brief.culture);

  heading(`INTERVIEW ANGLES (${brief.interviewAngles.length}) — inference, not cited`);
  for (const a of brief.interviewAngles) console.log(`  • ${a}`);

  if (brief.missingInfo.length > 0) {
    heading('STILL MISSING');
    for (const m of brief.missingInfo) console.log(`  • ${m}`);
  }

  heading('SOURCES READ');
  for (const s of brief.sources) console.log(`  [${s.provider}] ${s.url}`);

  console.log(
    '\n\x1b[2mAny "dropped N uncited claim(s)" warning above is the guard working.\x1b[0m',
  );
}

main().catch((err) => {
  console.error('\n✗ Research failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
