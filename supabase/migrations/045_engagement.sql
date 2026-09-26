-- ============================================================================
--  045 — Progress & Engagement: weekly task points + reminder emails
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--  Idempotent: safe to re-run.
--
--  Tasks are fixed in code (packages/contracts/src/engagement.ts) and ticked off
--  from job_events / tool_results / saved_jobs, so there is no task table.
--  Only two facts need storing:
--    points_ledger  — one row per task finished per week. The unique key makes
--                     awarding idempotent: re-reading the dashboard can't double
--                     the points. Points are a score, never credits.
--    reminder_sends — one row per reminder email sent. The unique key is the
--                     claim that stops two backend instances sending it twice.
--  users.email_reminders is the opt-out the unsubscribe link flips.
-- ============================================================================

create table if not exists public.points_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  task_key     text not null,
  -- Monday the task's week started (UTC).
  period_start date not null,
  points       integer not null check (points > 0),
  created_at   timestamptz not null default now(),
  unique (user_id, task_key, period_start)
);

create table if not exists public.reminder_sends (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  -- 'weekly_tasks' | 'follow_ups'
  kind       text not null,
  -- The week (Monday, YYYY-MM-DD) or day the reminder was for.
  period_key text not null,
  sent_at    timestamptz not null default now(),
  unique (user_id, kind, period_key)
);

alter table public.users
  add column if not exists email_reminders boolean not null default true;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Backend-only (service role bypasses RLS). No policies => the anon key can
-- neither read nor write, same as saved_jobs / tool_results.
alter table public.points_ledger enable row level security;
alter table public.reminder_sends enable row level security;

-- Verify after running:
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public' and rowsecurity=false;
--   -- expect zero rows
