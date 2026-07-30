-- ============================================================================
--  017 — Tool run history (sprint F5)
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
--  One row per successful tool run, so a user can reopen what a tool produced
--  without paying for it again — reading history costs no credits and no LLM
--  calls. Also the raw material for personalising the coaching tool later.
--
--  Text only, no binaries: `result` is jsonb and `input_summary` is a short
--  human-readable label. There is no blob storage anywhere in this project and
--  this table does not introduce one.
--
--  CV Optimizer is NOT written here — its output already lives in
--  `cv_analysis_jobs` (migration 005) and duplicating it would mean two sources
--  of truth for the same run.
-- ============================================================================

create table if not exists public.tool_results (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  tool          text not null check (tool in ('cv', 'dream', 'interview')),
  -- Short label for the list view, e.g. "Data Analyst · London".
  input_summary text,
  -- The tool's output, exactly as the UI needs it to re-render the result.
  result        jsonb not null,
  created_at    timestamptz not null default now()
);

-- The one query the history screen makes: this user's runs, newest first.
create index if not exists tool_results_user_idx
  on public.tool_results (user_id, created_at desc);

-- RLS: backend-only (service role bypasses RLS). No policies => the anon key can
-- neither read nor write, so one user can never reach another's history even if
-- they guess an id. Scoping by user_id also happens in the service layer.
alter table public.tool_results enable row level security;

-- Verify after running:
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename='tool_results' and rowsecurity=false;
--   -- expect zero rows
