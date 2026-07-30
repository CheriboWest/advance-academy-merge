-- ============================================================================
--  013 — Trial tier + lifetime tool quotas (CA-001, ticket P2/2c)
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
--  A "trial" account is minted by the quiz→passwordless funnel. It may use each
--  AI tool only a fixed number of LIFETIME times (not per-day) before being
--  pushed to referral/Mentorship. Existing classroom students are unaffected:
--  the tier column defaults to 'student' (full access), so only accounts that
--  the funnel EXPLICITLY marks 'trial' are ever capped.
--
--  This is a persistent, never-resetting counter — deliberately separate from
--  the in-memory per-day cap in backend/src/lib/rate-limit.ts (perUserDaily).
--  The two compose: a trial user hits whichever limit comes first.
-- ============================================================================

-- 1) Account tier. Default 'student' => fail-open for every pre-existing user.
alter table public.users
  add column if not exists tier text not null default 'student';

-- Guard against typos flowing in from app code.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_tier_check'
  ) then
    alter table public.users
      add constraint users_tier_check check (tier in ('student', 'trial'));
  end if;
end $$;

-- 2) Lifetime usage ledger: one row per (user, tool), monotonically increasing.
create table if not exists public.trial_usage (
  user_id    uuid not null references public.users (id) on delete cascade,
  tool       text not null check (tool in ('cv', 'dream', 'interview')),
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, tool)
);

-- 3) RLS: backend-only (service role bypasses RLS). No policies => the anon key
--    can neither read nor write. Mirrors candidate_leads (migration 012).
alter table public.trial_usage enable row level security;

-- Verify after running:
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename in ('trial_usage') and rowsecurity=false;
--   -- expect zero rows
