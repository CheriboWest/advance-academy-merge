-- ============================================================================
--  016 — Admin action audit log (sprint F4)
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
--  Every tier change, credit adjustment and admin-flag flip made from
--  /admin/users is recorded here: who did it, to whom, and what changed. The F4
--  acceptance criterion is "cộng credit → số dư đổi + ghi ai/khi nào", and a
--  credit balance alone can't answer "who granted this".
--
--  Append-only by convention — nothing in the app updates or deletes rows.
-- ============================================================================

create table if not exists public.admin_actions (
  id             uuid primary key default gen_random_uuid(),
  -- The admin who performed the action.
  actor_id       uuid not null references public.users (id),
  -- The account it was performed on.
  target_user_id uuid not null references public.users (id) on delete cascade,
  action         text not null check (action in ('set_tier', 'adjust_credits', 'set_admin')),
  -- Before/after values, e.g. {"from":"trial","to":"membership","granted":20}
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- Newest-first history for one account (the shape the admin UI reads).
create index if not exists admin_actions_target_idx
  on public.admin_actions (target_user_id, created_at desc);

-- RLS: backend-only (service role bypasses RLS). No policies => the anon key can
-- neither read nor write. Mirrors trial_usage / candidate_leads.
alter table public.admin_actions enable row level security;

-- Verify after running:
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename='admin_actions' and rowsecurity=false;
--   -- expect zero rows
