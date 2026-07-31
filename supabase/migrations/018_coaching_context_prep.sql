-- ============================================================================
--  018 — Coaching context prep (sprint Coaching Tool, ticket T0)
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--  Idempotent: safe to re-run.
--
--  The Coaching tool reads everything a student has already produced and hands
--  it to the coach as context. Today three things block that:
--
--   1. `cv_analysis_jobs` stores the CV Optimizer's OUTPUT but not its INPUT —
--      we have an analysis with no record of which CV, which target role, or
--      which JD produced it. Useful on its own screen, near-useless as context.
--
--   2. `tool_results` stores only the output too. For Dream Company that means
--      the roadmap survives but `ProfileAnalysis` (market level, core
--      strengths, critical gaps, readiness score) — the single richest signal
--      about where a student stands — is thrown away.
--
--   3. Both CV Optimizer and Dream Company accept a CV, use it, and drop it.
--      `cv_versions` is meant to be the one place a user's CV lives.
--
--  The rule this migration encodes: every tool run keeps its input as well as
--  its output, and any run that saw a CV points at a `cv_versions` row.
-- ============================================================================

-- ── 1. cv_versions: dedupe key + provenance ─────────────────────────────────
--
-- `text_hash` lets CV Optimizer / Dream Company link the CV they were handed
-- without inserting a near-duplicate row on every single run: same text =>
-- same hash => reuse the existing version.
--
-- `origin` keeps the CV Library screen honest. Rows minted automatically by
-- another tool have no bullets and no gaps — listing them next to real
-- uploads would show the user CVs they never knowingly added. The library
-- filters to origin='library'; the Coaching context picker reads all of them.
alter table public.cv_versions
  add column if not exists text_hash text,
  add column if not exists origin text not null default 'library';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cv_versions_origin_check'
  ) then
    alter table public.cv_versions
      add constraint cv_versions_origin_check
      check (origin in ('library', 'cv_optimizer', 'dream_company', 'interview_lab', 'coaching'));
  end if;
end $$;

-- Partial: pre-existing rows have text_hash null and must not collide with
-- each other. Doubles as the lookup index for the reuse path.
create unique index if not exists idx_cv_versions_user_text_hash
  on public.cv_versions (user_id, text_hash)
  where text_hash is not null;

-- ── 2. cv_analysis_jobs: remember what was analysed ─────────────────────────
--
-- `input_json` holds the analysis request minus the CV body (target role, JD,
-- CV length) — the CV text itself lives in cv_versions, pointed at by
-- `cv_version_id`, so it is never stored twice.
alter table public.cv_analysis_jobs
  add column if not exists input_json jsonb,
  add column if not exists cv_version_id uuid
    references public.cv_versions (id) on delete set null;

create index if not exists idx_cv_analysis_jobs_cv_version
  on public.cv_analysis_jobs (cv_version_id)
  where cv_version_id is not null;

-- ── 3. tool_results: inputs, CV link, and the coaching tool ─────────────────
alter table public.tool_results
  add column if not exists input_json jsonb,
  add column if not exists cv_version_id uuid
    references public.cv_versions (id) on delete set null;

-- 'coaching' joins the enum. Drop-then-add rather than a guarded add: the
-- constraint already exists from migration 017, so it has to be replaced.
alter table public.tool_results
  drop constraint if exists tool_results_tool_check;

alter table public.tool_results
  add constraint tool_results_tool_check
  check (tool in ('cv', 'dream', 'interview', 'coaching'));

create index if not exists idx_tool_results_cv_version
  on public.tool_results (cv_version_id)
  where cv_version_id is not null;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
-- No new tables here, so no new RLS to enable — but re-assert it on the two
-- touched tables in case an earlier migration was applied by hand and the
-- `enable row level security` line never actually ran on live (see
-- 011_rls_hardening_sweep.sql for why this keeps happening).
alter table public.cv_analysis_jobs enable row level security;
alter table public.tool_results     enable row level security;
alter table public.cv_versions      enable row level security;

-- Verify after running:
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public'
--     and tablename in ('cv_analysis_jobs','tool_results','cv_versions')
--     and rowsecurity = false;
--   -- expect zero rows
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'tool_results_tool_check';
--   -- expect: CHECK (tool = ANY (ARRAY['cv','dream','interview','coaching']))
