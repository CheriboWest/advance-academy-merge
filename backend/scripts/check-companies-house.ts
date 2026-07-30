#!/usr/bin/env tsx
/**
 * Verify the Companies House API key actually works (sprint F6a).
 *
 * Usage (from the repo root or backend/):
 *   npm run check:companies-house --workspace backend
 *   npm run check:companies-house --workspace backend -- "monzo bank"
 *
 * Prints the first few matches for the query, then the full profile of the top
 * hit. Any failure is reported with the reason rather than a stack trace, so a
 * wrong or missing key is obvious.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  isCompaniesHouseConfigured,
  searchCompanies,
  getCompanyProfile,
} from '../src/lib/companies-house.js';

// Same cwd-flexible lookup as main.ts, so this runs from either directory.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'backend/.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile?.(candidate);
    break;
  }
}

const query = process.argv.slice(2).filter((a) => a !== '--').join(' ') || 'monzo';

async function main() {
  if (!isCompaniesHouseConfigured()) {
    console.error('✗ COMPANIES_HOUSE_API_KEY is not set in backend/.env');
    console.error('  Register a REST key at https://developer.company-information.service.gov.uk/');
    process.exit(1);
  }
  console.log(`Searching Companies House for "${query}"…\n`);

  const hits = await searchCompanies(query, 5);
  if (hits.length === 0) {
    console.log('Key works, but that query returned no matches. Try another name.');
    return;
  }

  for (const h of hits) {
    console.log(`  ${h.companyNumber}  ${h.title}  [${h.companyStatus ?? 'unknown'}]`);
  }

  const profile = await getCompanyProfile(hits[0].companyNumber);
  console.log(`\nProfile of the top hit:`);
  console.log(`  Name       ${profile?.companyName}`);
  console.log(`  Number     ${profile?.companyNumber}`);
  console.log(`  Status     ${profile?.companyStatus ?? '—'}`);
  console.log(`  Created    ${profile?.dateOfCreation ?? '—'}`);
  console.log(`  Address    ${profile?.registeredAddress ?? '—'}`);
  console.log(`  SIC codes  ${profile?.sicCodes.join(', ') || '—'}`);
  console.log('\n✓ Companies House key resolves and the API answered.');
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
