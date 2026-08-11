-- ============================================================================
--  022 — users.lead_id: an explicit link from an account back to its lead
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--  Idempotent: safe to re-run.
--
--  Nothing joined `public.users` to `public.candidate_leads` before this. Both
--  the "Account" column on /admin/leads and the account half of the person
--  drawer resolved by lower-casing the email on each side and comparing strings.
--
--  That works *today* only because the quiz posts one `email` variable to both
--  the lead capture and the account creation in the same request, so the two
--  sides cannot disagree. It is incidental, not guaranteed. It breaks when:
--    * the person changes their email — the migration 006 trigger only fires on
--      INSERT, so public.users.email can drift from auth.users.email;
--    * a second lead magnet ships — `candidate_leads` is unique on
--      (email, source), so one person becomes several rows and the reader has
--      to guess which one produced the account.
--
--  This does NOT merge the two tables. They stay separate on purpose: a lead
--  carries marketing consent under UK GDPR / PECR, an account does not. This is
--  a pointer, nothing more.
-- ============================================================================

begin;

-- ── 1. The column ──────────────────────────────────────────────────────────
-- ON DELETE SET NULL, not CASCADE: erasing a lead (a GDPR deletion request, say)
-- must never take the person's account and their work with it.
alter table public.users
  add column if not exists lead_id uuid references public.candidate_leads (id) on delete set null;

-- The lookup the admin screens make: "which of these leads has an account?"
create index if not exists users_lead_id_idx on public.users (lead_id);

-- ── 2. Backfill ────────────────────────────────────────────────────────────
-- Match the accounts that already exist to the lead that produced them, by the
-- only key there has ever been. Doing it now is cheap; every lead captured from
-- here on is linked at the moment the account is created.
--
-- `distinct on` picks one lead per email — the newest capture, which is the one
-- whose consent state is current. Without it a person present under two lead
-- magnets would make the UPDATE ambiguous.
with newest_lead as (
  select distinct on (lower(email)) lower(email) as email_key, id
    from public.candidate_leads
   order by lower(email), created_at desc
)
update public.users u
   set lead_id = nl.id
  from newest_lead nl
 where u.lead_id is null                    -- never overwrite an existing link
   and lower(u.email) = nl.email_key;

commit;

-- Verify after running:
--   select count(*) filter (where lead_id is not null) as linked,
--          count(*)                                    as accounts
--     from public.users;
--   -- `linked` should equal the number of accounts that came through the quiz.
--   -- Accounts created straight on /register have no lead and stay null: that
--   -- is correct, not a miss.
--
--   select tablename, rowsecurity from pg_tables
--    where schemaname='public' and rowsecurity=false;
--   -- expect zero rows (this migration adds no table, but the sweep is cheap)
