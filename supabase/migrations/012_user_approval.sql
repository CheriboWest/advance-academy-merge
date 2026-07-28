-- 012_user_approval.sql
--
-- Adds an admin approval gate to sign-up. Registration stays self-service, but a new
-- account lands in `pending` and cannot reach any AI tool until an admin approves it.
--
-- Enforcement is a single check in the Fastify auth preHandler (backend/src/main.ts) —
-- every route already flows through it, so all current and future features are covered
-- without per-route changes.
--
-- Apply manually through the Supabase SQL editor (this project has no migration CLI —
-- see CLAUDE.md). Run the steps IN ORDER: step 3 (the audit) must not be skipped.

-- ── Step 1: columns ───────────────────────────────────────────────────────────
-- `status` defaults to 'pending', so public.handle_new_auth_user() (migration 006)
-- needs no change — every new sign-up inherits the default automatically.

alter table public.users
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists is_admin boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.users(id);

create index if not exists users_status_idx on public.users (status);

comment on column public.users.status is
  'Admin approval gate. Only "approved" users pass the backend auth preHandler.';
comment on column public.users.is_admin is
  'Grants access to /admin/users. Seeded manually — see step 4.';

-- ── Step 2: keep RLS on ───────────────────────────────────────────────────────
-- No-op if already enabled. The backend reads this table with the service-role key,
-- which bypasses RLS entirely, so this has zero effect on the running app.
-- Consistent with 011_rls_hardening_sweep.sql.

alter table public.users enable row level security;

-- ── Step 3: AUDIT existing accounts — do NOT blanket-approve ──────────────────
-- Registration has been open, so this table may already contain accounts nobody
-- authorised. Approving everything to "avoid disruption" would leave every
-- unauthorised account inside — which is the exact hole this migration closes.
--
-- 3a. Export the current list and have it reviewed by the programme owner:
--
--   select email, created_at, status
--   from public.users
--   where id <> '00000000-0000-0000-0000-000000000000'
--   order by created_at;
--
-- 3b. Approve ONLY the reviewed addresses. Replace the list below, then run:
--
--   update public.users
--   set status = 'approved', reviewed_at = now()
--   where email in (
--     'student1@example.com',
--     'student2@example.com'
--   );
--
-- 3c. Everything not listed stays 'pending' and is handled from /admin/users.
--     Reject in bulk once reviewed, if preferred:
--
--   update public.users set status = 'rejected', reviewed_at = now()
--   where status = 'pending' and created_at < '2026-07-28';

-- The MVP placeholder row from migration 001 is not a real login. Park it as rejected
-- so it never shows up in the pending queue.
update public.users
set status = 'rejected'
where id = '00000000-0000-0000-0000-000000000000';

-- ── Step 4: seed admins ───────────────────────────────────────────────────────
-- Seed AT LEAST TWO so approvals aren't blocked when one person is away.
-- Replace the addresses, then run:
--
--   update public.users
--   set is_admin = true, status = 'approved', reviewed_at = now()
--   where email in ('admin1@example.com', 'admin2@example.com');

-- ── Step 5: verify ────────────────────────────────────────────────────────────
--   select status, count(*) from public.users group by status;
--   select email from public.users where is_admin;
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and rowsecurity = false;   -- expect zero rows
