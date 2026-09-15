-- CareerHub UK — outreach tracking (post-send status, follow-ups, notes)
--
-- Additive and idempotent. Extends the existing `outreach_emails` table
-- (predates the migrations directory — see migration 0001's header comment)
-- rather than creating a parallel table: one row already represents one
-- outreach attempt for a (coach, company), which is exactly what "outreach
-- activity" means here. Adds the columns and indexes an activity dashboard
-- needs; nothing existing is dropped, renamed, or retyped.
--
-- contact_id, not recruiter_id
-- ----------------------------
-- `outreach_emails` already has a `recruiter_id` column (visible in the
-- pre-existing OutreachEmail TS type), but its exact semantics/target were
-- never confirmed against the live schema — this codebase has hit that
-- exact class of bug twice already this session (assuming a column's
-- meaning instead of verifying it). A fresh, explicitly-defined
-- `contact_id` FK avoids gambling on it; `recruiter_id` is left untouched.
--
-- status stays a free-text column, no CHECK constraint
-- ------------------------------------------------------
-- The application (Next.js server actions) is the source of truth for the
-- five-value contract (draft/sent/replied/follow_up_due/closed), enforced
-- in TypeScript. `follow_up_due` is deliberately never *stored* — it is
-- computed at read time from `status = 'sent' and follow_up_at <= now()`
-- (see lib/outreach-activity.ts computeDisplayStatus), so the four stored
-- values are draft/sent/replied/closed. A DB-level CHECK was considered but
-- skipped: unlike a brand-new table, this table already has live rows
-- whose exact status values can't be verified from here, and a constraint
-- that unexpectedly rejects one would break every future save for that row.

alter table if exists public.outreach_emails
  add column if not exists contact_id uuid references public.contacts (id) on delete set null,
  add column if not exists recipient_email text,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists follow_up_at timestamptz,
  add column if not exists notes text;

comment on column public.outreach_emails.contact_id is
  'The contact this outreach was addressed to, if one was chosen (vs. a manually-typed email). Set null, not deleted, if the contact is later removed.';
comment on column public.outreach_emails.recipient_email is
  'The actual address the email was sent to — set when the send succeeds, independent of whether a contact was chosen.';
comment on column public.outreach_emails.last_contacted_at is
  'Most recent successful send for this row. Currently always equal to sent_at (one send per row today) but named separately for when a row can represent more than one contact touch.';
comment on column public.outreach_emails.follow_up_at is
  'Coach-set date to follow up by. A sent row past this date displays as "follow_up_due" without being stored that way — see lib/outreach-activity.ts.';
comment on column public.outreach_emails.notes is
  'Coach notes about this specific outreach attempt (e.g. how it went, what to say next) — distinct from a company''s or contact''s own notes.';

-- The activity dashboard filters by coach + status and looks up a company's
-- or contact's history by id.
create index if not exists outreach_emails_coach_status_idx
  on public.outreach_emails (coach_user_id, status);
create index if not exists outreach_emails_company_id_idx
  on public.outreach_emails (company_id);
create index if not exists outreach_emails_contact_id_idx
  on public.outreach_emails (contact_id);
