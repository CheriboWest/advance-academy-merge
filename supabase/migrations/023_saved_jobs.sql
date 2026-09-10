-- ============================================================================
--  023 — Individual Job Tracking (AI Job Tools 1.3)
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--  Idempotent: safe to re-run.
--
--  One row per job a user is tracking — the "saved jobs" card that every later
--  feature (AI Apply 1.1, Cover Letter 1.2, Gamification 1.4) reads and writes.
--  A card moves through statuses; every status change is appended to
--  `job_events`, which is the event stream gamification will count later.
--
--  Text only, no binaries. `cv_version_id` and `cover_letter_text` are reserved
--  attachment slots so 1.1/1.2 need no migration to link their output.
--  Nothing here calls an LLM — the tracker costs nothing but Supabase rows.
-- ============================================================================

-- ── 1. Saved jobs ───────────────────────────────────────────────────────────
create table if not exists public.saved_jobs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,

  -- Where the card came from. 'career_hub' is reserved for the sister app's
  -- deep link (/jobs?add=<url>); it is not written by this repo yet.
  source            text not null default 'manual'
    check (source in ('manual', 'dream_company', 'career_hub')),

  title             text not null,
  company_name      text,
  location          text,
  job_url           text,
  -- Normalised host+path of job_url (lowercase, no query/hash/trailing slash).
  -- Computed by the backend; the unique index below is what makes "save the same
  -- link twice" return the existing card instead of a duplicate (AC7).
  url_key           text,
  -- Snippet or JD snapshot so the card survives the posting being taken down.
  description       text,
  -- Free text, e.g. "£40k–£55k". Ranges from providers vary too much to model.
  salary_text       text,
  -- From Career Hub's sponsor register when known; null = unknown.
  sponsor_visa      boolean,

  --  saved       pinned, nothing done yet
  --  preparing   tailoring CV / cover letter
  --  applied     submitted; applied_at set
  --  follow_up   waiting, chasing
  --  interview   in the interview loop
  --  offer       terminal
  --  rejected    terminal
  status            text not null default 'saved'
    check (status in ('saved', 'preparing', 'applied', 'follow_up',
                      'interview', 'offer', 'rejected')),

  notes             text,
  applied_at        timestamptz,
  -- Calendar dates, not instants: the user picks a day, and "due today" is
  -- judged against the user's own local date on the client.
  deadline_at       date,
  next_follow_up_at date,

  -- Reserved attachment slots for 1.1 / 1.2.
  cv_version_id     uuid references public.cv_versions (id) on delete set null,
  cover_letter_text text,

  created_at        timestamptz not null default now(),
  -- Set by the backend on every update (no trigger, like every other table here).
  updated_at        timestamptz not null default now()
);

-- One card per (user, link). Partial so manual cards without a URL never collide.
create unique index if not exists saved_jobs_user_url_key
  on public.saved_jobs (user_id, url_key)
  where url_key is not null;

-- The dashboard query: this user's cards, grouped by status, freshest first.
create index if not exists saved_jobs_user_status_idx
  on public.saved_jobs (user_id, status, updated_at desc);

-- "Follow-ups due" list. Partial: most cards have no follow-up date.
create index if not exists saved_jobs_follow_up_idx
  on public.saved_jobs (user_id, next_follow_up_at)
  where next_follow_up_at is not null;

-- ── 2. Status change log ────────────────────────────────────────────────────
-- Append-only by convention — nothing in the app updates or deletes rows.
-- `from_status` is null for the creation event.
create table if not exists public.job_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.saved_jobs (id) on delete cascade,
  -- Denormalised so gamification can count a user's events without a join.
  user_id     uuid not null references public.users (id) on delete cascade,
  from_status text,
  to_status   text not null,
  note        text,
  created_at  timestamptz not null default now()
);

-- Timeline on one card.
create index if not exists job_events_job_idx
  on public.job_events (job_id, created_at desc);

-- Per-user event stream (gamification 1.4 reads this).
create index if not exists job_events_user_idx
  on public.job_events (user_id, created_at desc);

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- Backend-only (service role bypasses RLS). No policies => the anon key can
-- neither read nor write. Scoping by user_id also happens in the service layer,
-- exactly like tool_results / coaching_sessions.
alter table public.saved_jobs enable row level security;
alter table public.job_events enable row level security;

-- Verify after running:
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public' and rowsecurity=false;
--   -- expect zero rows
--   select indexname from pg_indexes where tablename in ('saved_jobs','job_events');
--   -- expect 5 indexes plus the two primary keys
