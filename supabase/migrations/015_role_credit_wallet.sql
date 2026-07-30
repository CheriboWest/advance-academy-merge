-- ============================================================================
--  015 — Tiers + shared credit wallet + admin flag (sprint F1/F2)
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
--  Replaces the per-tool lifetime quota of migration 013 with ONE credit
--  wallet per user. Tool prices are charged against that single balance:
--
--    tier='trial'       2 credits   (referral tops up +2 per invite, cap 3 => 8)
--    tier='membership'  20 credits  + Interview Lab (mock interview) access
--    is_admin=true      unlimited   + /admin access — orthogonal to tier, so a
--                                     coach can hold a real tier for testing
--                                     and never locks themselves out of /admin
--                                     by a mistyped tier.
--
--  Prices (env-tunable, see backend/src/lib/credits.ts):
--    CV Optimiser 1 · Dream Company 2 · Interview Lab 1
--
--  MIGRATION SAFETY — nobody loses access:
--  `tier` defaulted to 'student' in 013 (fail-open for every pre-existing
--  classroom account). Those rows become 'membership' here, which keeps their
--  tool access and ADDS Interview Lab. They do move from "uncapped" to "20
--  credits" — that is the intended product decision, and CREDIT_GRANT_MEMBERSHIP
--  below is the knob if it needs raising.
--
--  `trial_usage` (013) is KEPT but becomes legacy history: nothing writes to it
--  after this migration. Its only remaining job — "has this user actually used a
--  tool?", the signal that gates referral payouts — moves to the explicit
--  `users.first_tool_used_at` column added below.
-- ============================================================================

-- 1) Credit wallet, admin flag, and the activation timestamp.
alter table public.users
  add column if not exists credit_balance integer not null default 2
    check (credit_balance >= 0),
  add column if not exists is_admin boolean not null default false,
  -- Set the first time the user spends credits on any tool. Referral rewards
  -- are only paid out once the invitee reaches this point.
  add column if not exists first_tool_used_at timestamptz;

-- 2) Widen the tier vocabulary: 'student' (013's fail-open default) retires in
--    favour of 'membership'. Drop the old constraint first so the UPDATE can run.
alter table public.users drop constraint if exists users_tier_check;

update public.users set tier = 'membership' where tier = 'student';

alter table public.users
  add constraint users_tier_check check (tier in ('trial', 'membership'));

-- New signups are trial: they get in and can use the basic tools immediately,
-- and an admin upgrades them to membership. (The passwordless funnel also sets
-- 'trial' explicitly — this default covers every other signup path.)
alter table public.users alter column tier set default 'trial';

-- 3) Seed balances. Column default already gave everyone 2; top membership up.
--    Keep this in sync with CREDIT_GRANT_MEMBERSHIP in backend/.env.
update public.users set credit_balance = 20 where tier = 'membership';

-- 4) Carry over referral rewards already earned under the 013/014 model, so no
--    trial user loses credits they invited friends for. (bonus_count was a
--    per-tool top-up; it collapses into the single wallet.)
update public.users u
set credit_balance = u.credit_balance + coalesce((
      select sum(t.bonus_count) from public.trial_usage t where t.user_id = u.id
    ), 0)
where u.tier = 'trial';

-- 5) Backfill the activation timestamp for anyone who already used a tool, so
--    the referral payout isn't re-triggered for historic users.
update public.users u
set first_tool_used_at = now()
where u.first_tool_used_at is null
  and exists (
    select 1 from public.trial_usage t where t.user_id = u.id and t.used_count > 0
  );

-- 6) RLS. `public.users` is service-role-only (RLS on, zero policies), which is
--    what stops a logged-in user from editing their own tier/credit/is_admin
--    with the anon key. Idempotent re-assert — see migration 011.
alter table public.users enable row level security;

-- Verify after running:
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename='users';
--   -- expect rowsecurity = true
--
--   select policyname from pg_policies
--   where schemaname='public' and tablename='users';
--   -- expect zero rows (service role bypasses RLS; nobody else may touch it)
--
--   select tier, is_admin, count(*), min(credit_balance), max(credit_balance)
--   from public.users group by tier, is_admin;
--   -- expect every pre-existing account on tier='membership' with 20 credits
