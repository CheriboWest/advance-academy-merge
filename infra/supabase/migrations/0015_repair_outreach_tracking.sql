-- CareerHub UK — repair outreach_emails tracking columns if 0012 never landed
--
-- Same root cause and same fix shape as
-- 0014_repair_company_summary_view.sql: migration 0012 already adds
-- everything the Outreach activity dashboard needs (contact_id,
-- recipient_email, last_contacted_at, follow_up_at, notes) to
-- outreach_emails — the live database this was reported against had simply
-- never had 0012 applied (or a migration tool's history table marked it
-- "applied" without every statement landing), so PostgREST rejected
-- `.order("last_contacted_at", ...)` with "column outreach_emails.
-- last_contacted_at does not exist". The same missing columns would also
-- break saveDraftAction's contact_id write, setFollowUpAction, and
-- saveOutreachNotesAction (app/coach/(workspace)/outreach/actions.ts) —
-- this repairs all of them at once, not just the one column the reported
-- error happened to name first.
--
-- Unlike the public_company_summary fix, there is no column-order hazard
-- here: `alter table ... add column if not exists` has no positional
-- constraint the way `create or replace view` does (see 0013/0014's
-- header comments for that one) — outreach_emails is a plain table, not a
-- view, so this is exactly migration 0012's own statements, verbatim,
-- under a fresh migration number so it runs regardless of whatever a
-- migration tool believes 0012's applied state to be. A no-op wherever
-- 0012 did take effect; the actual fix wherever it didn't.

alter table if exists public.outreach_emails
  add column if not exists contact_id uuid references public.contacts (id) on delete set null,
  add column if not exists recipient_email text,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists follow_up_at timestamptz,
  add column if not exists notes text;

create index if not exists outreach_emails_coach_status_idx
  on public.outreach_emails (coach_user_id, status);
create index if not exists outreach_emails_company_id_idx
  on public.outreach_emails (company_id);
create index if not exists outreach_emails_contact_id_idx
  on public.outreach_emails (contact_id);
