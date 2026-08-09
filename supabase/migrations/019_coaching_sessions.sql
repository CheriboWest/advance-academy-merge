-- ============================================================================
--  019 — Coaching sessions + the coaching quota (sprint Coaching Tool, T1)
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--  Idempotent: safe to re-run.
--
--  One row per booked coaching session. The row is the whole lifecycle: what the
--  student submitted, what context they attached, what the pipeline generated,
--  what the coach edited and approved, and what came out of the session itself.
--
--  Why a separate quota instead of the credit wallet (migration 015):
--  credits meter LLM spend, and every price in `credits.ts` is set that way.
--  A coaching session's scarce resource is an hour of the coach's time, which no
--  amount of tokens buys. Pricing it in credits forces a bad trade — set it high
--  enough to be "one per membership" (20) and the student has nothing left to run
--  the very tools that produce the session's context; set it low and it stops
--  meaning one session. `coaching_credits` keeps the two independent.
-- ============================================================================

-- ── 1. The quota ────────────────────────────────────────────────────────────
alter table public.users
  add column if not exists coaching_credits integer not null default 0
    check (coaching_credits >= 0);

-- Existing membership accounts get their session. Guarded on `= 0` so re-running
-- this migration can never top anyone back up after they have spent it.
update public.users
   set coaching_credits = 1
 where tier = 'membership'
   and coaching_credits = 0;

-- ── 2. Coaching sessions ────────────────────────────────────────────────────
create table if not exists public.coaching_sessions (
  id                uuid primary key default gen_random_uuid(),

  -- Whose session this is, and who filled the form. They differ when a coach
  -- books on a student's behalf, which is why `created_by` is not `student_id`.
  student_id        uuid not null references public.users (id) on delete cascade,
  created_by        uuid references public.users (id) on delete set null,

  -- Phase 1 only implements 'interview_prep'. The column exists now because
  -- adding it later means a migration plus a refactor of every read.
  session_type      text not null default 'interview_prep'
    check (session_type in ('interview_prep', 'cv_review', 'career_direction')),

  --  draft           created, not submitted (a coach filling one in)
  --  generating      context readiness or the pack pipeline is running
  --  context_needed  too little was found; waiting on the coach to fill gaps
  --  ready           pack generated, waiting on the coach to review
  --  failed          generation errored; see error_json
  --  approved        coach signed it off — the student can now see it
  --  done            the session happened and has notes
  --  cancelled       called off
  status            text not null default 'draft'
    check (status in ('draft', 'generating', 'context_needed', 'ready', 'failed',
                      'approved', 'done', 'cancelled')),

  -- ── What the student submitted ──
  company_name      text not null,
  company_url       text,
  jd_text           text not null,
  -- Which interview round, and who is running it. Both steer the question set.
  stage             text,
  interviewer_role  text,
  -- "What worries you most" — the cheapest input in the form and the one that
  -- most often tells the coach where to spend the hour.
  worry_text        text,

  -- What the student ticked in the context picker: which cv_version, which
  -- tool_results rows, which cv_analysis_jobs. Ids only — the payloads stay in
  -- their own tables so this row never goes stale against them.
  context_refs      jsonb not null default '{}'::jsonb,

  -- ── Scheduling ──
  -- The real interview the student is preparing for. Drives the coach's queue
  -- order: sessions are urgent relative to this, not to when they were booked.
  interview_at      timestamptz,
  -- Student proposes a few windows, coach confirms one into `scheduled_at`.
  -- Deliberately not a slot engine: the scarce thing is coach time, and one
  -- person eyeballing a calendar handles that better than a booking system.
  proposed_slots    jsonb not null default '[]'::jsonb,
  scheduled_at      timestamptz,

  -- ── Generation ──
  -- Context readiness verdict (score + what is missing) from stage 0.
  context_report    jsonb,
  -- Free text the coach adds before generating. Goes straight into the prompt —
  -- the cheapest personalisation available, and the only place knowledge like
  -- "this student freezes on competency questions" can enter the pipeline.
  coach_notes       text,
  generated_pack    jsonb,
  error_json        jsonb,

  -- ── After the session ──
  session_notes     jsonb,
  approved_at       timestamptz,
  approved_by       uuid references public.users (id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The student's own list.
create index if not exists idx_coaching_sessions_student
  on public.coaching_sessions (student_id, created_at desc);

-- The coach's queue: everything still needing attention, soonest interview
-- first. Partial, because settled sessions are the bulk of the table over time
-- and never appear in this view.
create index if not exists idx_coaching_sessions_open
  on public.coaching_sessions (interview_at nulls last)
  where status not in ('done', 'cancelled');

-- The calendar view reads by confirmed slot.
create index if not exists idx_coaching_sessions_scheduled
  on public.coaching_sessions (scheduled_at)
  where scheduled_at is not null;

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- Backend-only, same stance as tool_results (017) and trial_usage (013): RLS on
-- with no policies, so the anon key can neither read nor write. "A student sees
-- only their own sessions, an admin sees all" is enforced in the service layer,
-- which is also the only place that can tell the two apart — the service role
-- bypasses RLS, so a policy here would never run for real traffic anyway.
alter table public.coaching_sessions enable row level security;

-- Verify after running:
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename='coaching_sessions'
--     and rowsecurity = false;
--   -- expect zero rows
--
--   select count(*) from public.users where tier='membership' and coaching_credits > 0;
--   -- expect: your membership accounts
