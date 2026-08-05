-- 012_candidate_leads.sql
--
-- Migration: create the `candidate_leads` table — the store behind the
-- Candidate Acquisition lead-capture pipe. A "lead" is a job-seeker who left
-- their email in exchange for value from one of our tools (CV grader, career
-- quiz, etc.). Any lead magnet feeds THIS one table via POST /api/leads/capture.
--
-- SECURITY (read this): unlike `companies` / `company_additional_url` (migration
-- 008), lead rows hold personal contact data (email) and MUST NOT be readable by
-- the public `anon` role. RLS is enabled and NO anon/authenticated policy is
-- created, so PostgREST returns nothing to the anon key. Only the backend, which
-- uses the service-role key (bypasses RLS), can read/write. This is the exact
-- class of bug migration 011 had to sweep up — do not add `grant ... to anon`.
--
-- Apply manually through the Supabase SQL editor (this project has no migration
-- CLI — see CLAUDE.md). Safe to re-run: guarded with IF NOT EXISTS / IF EXISTS.

begin;

-- ── 1. Table ───────────────────────────────────────────────────────────────
create table if not exists public.candidate_leads (
  id                uuid primary key default gen_random_uuid(),

  -- Who the lead is.
  email             text not null,
  name              text,

  -- Where the lead came from. `source` is the lead-magnet family
  -- ('quiz' | 'readiness' | ...); `lead_magnet_id` is an optional finer id.
  source            text not null,
  lead_magnet_id    text,

  -- What we gave them back (full report / score payload) + a qualifying signal.
  result            jsonb,
  readiness_score   integer,

  -- Consent (UK GDPR / PECR). `consent_marketing` is the explicit, un-pre-ticked
  -- opt-in checkbox; `consent_ts` is when it was given.
  consent_marketing boolean not null default false,
  consent_ts        timestamptz,

  -- Double opt-in: the lead is only "confirmed" after they click the email link.
  double_optin      boolean not null default false,
  optin_token       text,

  -- Attribution.
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,

  -- Lifecycle: new -> confirmed -> nurturing -> enrolled | unsub
  status            text not null default 'new',

  created_at        timestamptz not null default now(),

  -- Same person from the same source is one lead, not many.
  constraint candidate_leads_unique_email_source unique (email, source),

  -- Cheap email sanity check; full validation happens in app code.
  constraint candidate_leads_email_shape check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table public.candidate_leads is
  'Job-seeker leads captured by the Candidate Acquisition pipe. Backend-only (service-role); anon must never read this.';

-- ── 2. Indexes ─────────────────────────────────────────────────────────────
create index if not exists idx_candidate_leads_email  on public.candidate_leads (email);
create index if not exists idx_candidate_leads_status on public.candidate_leads (status);
create index if not exists idx_candidate_leads_token  on public.candidate_leads (optin_token);

-- ── 3. RLS: ON, and DELIBERATELY no anon/authenticated policy ───────────────
-- With RLS enabled and no permissive policy, the anon/authenticated roles get
-- zero rows from PostgREST. The backend service-role key bypasses RLS, so the
-- app is unaffected. Do NOT grant to anon here.
alter table public.candidate_leads enable row level security;

grant all on table public.candidate_leads to service_role;

commit;

-- ── Verify after running (paste separately in the SQL editor) ───────────────
-- Expect ZERO rows (candidate_leads must NOT appear):
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public' and rowsecurity=false;
--
-- And from a shell, with the ANON key, expect an empty array / permission error:
--   curl "$SUPABASE_URL/rest/v1/candidate_leads?select=*" -H "apikey: $SUPABASE_ANON_KEY"
