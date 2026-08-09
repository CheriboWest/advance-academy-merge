#!/usr/bin/env tsx
/**
 * Verify migration 018 actually landed on the live database.
 *
 * Usage (from the repo root or backend/):
 *   npm run check:migration-018 --workspace backend
 *
 * Migrations in this project are applied by hand in the Supabase SQL editor, so
 * "the file exists in the repo" and "the column exists in the database" are two
 * different claims — and the gap between them has bitten this project before
 * (see 011_rls_hardening_sweep.sql). Everything 018 adds is optional at the
 * write site: `ensureCvVersion` and `recordToolResult` swallow their errors by
 * design, so a missing column produces no user-visible failure at all. It just
 * silently stops collecting the context the Coaching tool is built on.
 *
 * This script is the check that closes that gap. It selects each new column and
 * reports which ones the database rejects.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
// Safe as a static import: getSupabase() reads process.env when it is first
// called, not at module load, so the .env lookup below still wins.
import { getSupabase } from '../src/lib/supabase.js';

// Same cwd-flexible lookup as main.ts, so this runs from either directory.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'backend/.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile?.(candidate);
    break;
  }
}

/** One column 018 is supposed to have added. */
const EXPECTED: Array<{ table: string; column: string }> = [
  { table: 'cv_versions', column: 'text_hash' },
  { table: 'cv_versions', column: 'origin' },
  { table: 'cv_analysis_jobs', column: 'input_json' },
  { table: 'cv_analysis_jobs', column: 'cv_version_id' },
  { table: 'tool_results', column: 'input_json' },
  { table: 'tool_results', column: 'cv_version_id' },
];

async function columnExists(table: string, column: string): Promise<string | null> {
  const { error } = await getSupabase().from(table).select(column).limit(1);
  return error ? error.message : null;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in backend/.env');
    process.exit(1);
  }

  console.log('Checking migration 018 (coaching context prep)…\n');

  let missing = 0;
  for (const { table, column } of EXPECTED) {
    const failure = await columnExists(table, column);
    if (failure) {
      missing++;
      console.log(`  ✗ ${table}.${column} — ${failure}`);
    } else {
      console.log(`  ✓ ${table}.${column}`);
    }
  }

  // The enum widening is invisible to a select, so probe it the only way
  // PostgREST allows: filter on the new value. A live check constraint accepts
  // the comparison and returns zero rows; a stale one still parses fine, so this
  // confirms the column is queryable rather than the constraint text. The
  // constraint itself is verified by the SQL at the bottom of the migration.
  const { error: coachingErr } = await getSupabase()
    .from('tool_results')
    .select('id')
    .eq('tool', 'coaching')
    .limit(1);
  if (coachingErr) {
    missing++;
    console.log(`  ✗ tool_results.tool = 'coaching' — ${coachingErr.message}`);
  } else {
    console.log("  ✓ tool_results queryable by tool = 'coaching'");
  }

  if (missing > 0) {
    console.error(
      `\n✗ ${missing} check(s) failed. Run supabase/migrations/018_coaching_context_prep.sql` +
        ' in the Supabase SQL editor, then re-run this script.',
    );
    process.exit(1);
  }

  console.log('\n✓ Migration 018 is live.');
  console.log(
    "  Also confirm the check constraint by hand:\n" +
      "    select pg_get_constraintdef(oid) from pg_constraint\n" +
      "    where conname = 'tool_results_tool_check';",
  );
}

main().catch((err) => {
  console.error('✗ Check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
