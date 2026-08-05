-- 018_user_approval.sql
--
-- Adds an admin approval gate to sign-up. Registration stays self-service (magic
-- link, migration CA-001/P2), but a new account lands in `pending` and cannot reach
-- any AI tool until an admin approves it from /admin/users.
--
-- Enforcement is a single check in the Fastify auth preHandler (backend/src/main.ts) —
-- every route already flows through it, so all current and future features are covered
-- without per-route changes. `/api/account/me` is the one exemption, so the /pending
-- screen can read its own status.
--
-- Relationship to 015 (tier + credit wallet): ORTHOGONAL. `status` answers "is this
-- person allowed in at all", `tier`/`credit_balance` answer "how much can they spend
-- once they are". `is_admin` was already added by 015 — not re-added here.
--
-- Apply manually through the Supabase SQL editor (this project has no migration CLI —
-- see CLAUDE.md). Run the steps IN ORDER: step 3 (the audit) must not be skipped.

-- ── Step 1: columns ───────────────────────────────────────────────────────────
-- `status` defaults to 'pending', so public.handle_new_auth_user() (migration 006)
-- needs no change — every new sign-up inherits the default automatically.

alter table public.users
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.users(id);

create index if not exists users_status_idx on public.users (status);

comment on column public.users.status is
  'Admin approval gate. Only "approved" users pass the backend auth preHandler.';

-- ── Step 1b: let the audit log record approvals ───────────────────────────────
-- 016_admin_actions.sql predates the approval gate, so its CHECK rejects the
-- 'set_status' action that admin.service.ts writes on every approve/reject. The
-- audit rows go in as ONE batch insert, so without this an approve-and-upgrade in
-- the same PATCH silently loses BOTH rows (the insert is best-effort and only
-- logs `[admin] audit write failed`). Net effect: "who approved this account" —
-- the question 016 exists to answer — is unanswerable.

alter table public.admin_actions drop constraint if exists admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check
  check (action in ('set_tier', 'adjust_credits', 'set_admin', 'set_status'));

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
--   select email, tier, credit_balance, created_at, status
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

-- ── Step 4: keep the admins in ────────────────────────────────────────────────
-- `is_admin` (migration 015) does NOT bypass the approval gate — an admin whose row
-- is still 'pending' gets 403'd off /admin/users along with everyone else. Approve
-- every admin before you rely on this, and seed AT LEAST TWO so approvals aren't
-- blocked when one person is away:
--
--   update public.users
--   set is_admin = true, status = 'approved', reviewed_at = now()
--   where email in ('admin1@example.com', 'admin2@example.com');
--
-- ADMIN_USER_IDS (backend/.env) is the bootstrap backdoor for admin *rights*, but it
-- does not bypass the gate either. The env-listed accounts still need status='approved'.

-- ── Step 5: verify ────────────────────────────────────────────────────────────
--   select status, count(*) from public.users group by status;
--   select email, status from public.users where is_admin;   -- all must be 'approved'
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and rowsecurity = false;     -- expect zero rows
--
-- Then approve someone from /admin/users and confirm step 1b took — this must
-- return a 'set_status' row, and the backend log must show no `audit write failed`:
--   select action, detail, created_at from public.admin_actions
--   order by created_at desc limit 5;
