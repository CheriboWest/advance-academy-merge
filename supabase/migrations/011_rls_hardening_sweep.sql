-- 011_rls_hardening_sweep.sql
--
-- Fixes a Supabase security alert (`rls_disabled_in_public`, Critical): a public table
-- had Row-Level Security DISABLED, so anyone with the project's anon key (which ships
-- publicly in the frontend bundle by design) could hit PostgREST directly and read/write
-- it. The dashboard named `public.cv_analysis_jobs` — created by migration 005, which
-- contains NO `enable row level security` statement; that ALTER only ever lived in the
-- schema dump (schema_May_5_2026.sql:940) and was never applied to the live DB (migrations
-- here are run by hand via the SQL editor, no CLI — see CLAUDE.md). `company_additional_url`
-- (migration 008, GRANT ALL to anon + absent from the dump entirely) is a second table at
-- the same risk. This sweep re-enables RLS on EVERY public table that is missing it, not
-- just the named one, so the whole class of bug is closed rather than one instance.
--
-- Safe to run repeatedly: ENABLE ROW LEVEL SECURITY is a no-op when already on, and the
-- backend uses the service-role key (which bypasses RLS entirely), so enabling RLS has
-- ZERO effect on the running app — no deploy, no restart needed.
--
-- Apply manually through the Supabase SQL editor (this project has no migration CLI).

-- ── Step 1 (diagnose): see which public tables currently have RLS off ──────────
-- Run this first. Any row with rowsecurity = false is what the alert is naming.
--   select schemaname, tablename, rowsecurity
--   from pg_tables
--   where schemaname = 'public'
--   order by rowsecurity asc, tablename;

-- ── Step 2 (fix): enable RLS on every public table that is missing it ──────────
do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and rowsecurity = false
  loop
    execute format('alter table public.%I enable row level security;', t.tablename);
    raise notice 'Enabled RLS on public.%', t.tablename;
  end loop;
end $$;

-- ── Step 3 (verify): re-run the diagnose query; every row must be rowsecurity = true.
-- Then click "Resolve issue" on the Supabase dashboard to clear the alert.
--
-- NOTE: `cv_analysis_jobs` has no policies, so enabling RLS makes it service-role-only
-- (default deny for anon/authenticated). That is exactly right: the backend reads/writes
-- it via the service-role key, and the frontend never queries it directly — the CV
-- Optimizer polls `GET /api/cv-optimizer/jobs/:jobId` through the backend, not PostgREST.
-- `company_additional_url` keeps its intended behaviour — the SELECT policy from migration
-- 008 ("Anyone can read company additional URLs", USING (true)) still allows public reads,
-- while INSERT/UPDATE/DELETE are now blocked for anon (no write policy exists). No app
-- change required, no deploy, no restart.
