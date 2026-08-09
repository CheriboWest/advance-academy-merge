-- ============================================================================
--  020 — allow 'adjust_coaching' in the admin audit log
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--  Idempotent: safe to re-run.
--
--  Migration 018 (user approval) rewrote `admin_actions_action_check` to the four
--  actions that existed on that branch, which silently dropped the coaching
--  action added alongside migration 019. The audit write in admin.service.ts is
--  best-effort, so a rejected row does not fail the admin's request — it just
--  loses the answer to "who granted this student an extra session, and when".
--
--  Keep this list in sync with the `audits.push({ action: ... })` calls in
--  backend/src/services/admin.service.ts (unit-tested in admin.service.test.ts).
-- ============================================================================

alter table public.admin_actions drop constraint if exists admin_actions_action_check;

alter table public.admin_actions add constraint admin_actions_action_check
  check (action in ('set_tier', 'adjust_credits', 'set_admin', 'set_status', 'adjust_coaching'));
