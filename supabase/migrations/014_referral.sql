-- ============================================================================
--  014 — Referral loop (CA-001, ticket P3c)
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
--  A trial user who runs out of credits can invite friends. Each friend who
--  ACTIVATES (creates an account AND signs in via their magic link — not just
--  leaving an email) grants the inviter +2 Dream Company credits, capped at 3
--  successful referrals. Beyond that we stop granting and surface the Mentorship
--  CTA. Self-referral and never-activated (fake) emails never grant credit.
--
--  All columns hang off existing tables (users, trial_usage), both already RLS-
--  protected (migrations 011/013) — no new tables, no new policies.
-- ============================================================================

alter table public.users
  -- The user's OWN invite code (minted lazily on first request).
  add column if not exists referral_code text unique,
  -- Who invited THIS user (set at signup when a ?ref code is present).
  add column if not exists referred_by uuid references public.users (id),
  -- Whether the inviter has already been credited for THIS user (idempotency).
  add column if not exists referral_credited boolean not null default false,
  -- How many successful referrals THIS user has earned (as an inviter). Cap 3.
  add column if not exists referral_count integer not null default 0;

-- Bonus tool credits granted on top of the base trial quota (referral rewards).
alter table public.trial_usage
  add column if not exists bonus_count integer not null default 0 check (bonus_count >= 0);
