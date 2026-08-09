#!/usr/bin/env tsx
/**
 * Verify migration 019 actually landed on the live database.
 *
 * Usage (from the repo root or backend/):
 *   npm run check:migration-019 --workspace backend
 *
 * Same reason as check-migration-018: migrations here are applied by hand, so a
 * deploy can outrun its schema. 019 fails harder than 018 if that happens —
 * `coaching_sessions` not existing means booking is impossible, not merely
 * poorer — so this check is the gate before testing anything in the flow.
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

/** Every column the coaching flow reads or writes. */
const COACHING_SESSION_COLUMNS = [
  'id',
  'student_id',
  'created_by',
  'session_type',
  'status',
  'company_name',
  'company_url',
  'jd_text',
  'stage',
  'interviewer_role',
  'worry_text',
  'context_refs',
  'interview_at',
  'proposed_slots',
  'scheduled_at',
  'context_report',
  'coach_notes',
  'generated_pack',
  'error_json',
  'session_notes',
  'approved_at',
  'approved_by',
  'created_at',
  'updated_at',
];

// PromiseLike, not Promise: a Supabase query builder is a thenable and never
// grows the `catch`/`finally` a real Promise has.
async function probe(label: string, run: () => PromiseLike<{ error: unknown }>): Promise<boolean> {
  const { error } = await run();
  const message = (error as { message?: string } | null)?.message;
  if (message) {
    console.log(`  ✗ ${label} — ${message}`);
    return false;
  }
  console.log(`  ✓ ${label}`);
  return true;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in backend/.env');
    process.exit(1);
  }

  console.log('Checking migration 019 (coaching sessions)…\n');
  let failures = 0;

  const supabase = getSupabase();

  if (!(await probe('users.coaching_credits', () => supabase.from('users').select('coaching_credits').limit(1))))
    failures++;

  // One select over every column: a single missing one fails the whole query and
  // names itself in the error, which is exactly the report we want.
  if (
    !(await probe('coaching_sessions (all columns)', () =>
      supabase.from('coaching_sessions').select(COACHING_SESSION_COLUMNS.join(', ')).limit(1),
    ))
  )
    failures++;

  if (failures > 0) {
    console.error(
      `\n✗ ${failures} check(s) failed. Run supabase/migrations/019_coaching_sessions.sql` +
        ' in the Supabase SQL editor, then re-run this script.',
    );
    process.exit(1);
  }

  // The backfill is a data question, not a schema one, so report it rather than
  // failing on it: a project with no membership accounts yet is not broken.
  const { count } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('tier', 'membership')
    .gt('coaching_credits', 0);
  console.log(`\n  ℹ ${count ?? 0} membership account(s) hold a coaching session.`);

  console.log('\n✓ Migration 019 is live.');
  console.log(
    '  Also confirm RLS by hand:\n' +
      "    select tablename, rowsecurity from pg_tables\n" +
      "    where schemaname='public' and tablename='coaching_sessions';\n" +
      '    -- expect rowsecurity = true',
  );
}

main().catch((err) => {
  console.error('✗ Check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
