-- CareerHub UK — canonical schema mirror
--
-- Human-readable reference of the expected Supabase schema. The source of truth
-- is the Supabase project; migrations live in `infra/supabase/migrations/`.
-- Apply migrations in order, then this file should describe the resulting shape.

-- Companies (public + coach)
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique,
  name        text,
  website     text,
  careers_url text,
  sector      text,
  region      text,
  hq_location text,
  description text,
  lead_score  integer default 0,
  created_at  timestamptz default now()
);

-- Jobs (public). content_hash is the dedup key.
create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies (id),
  title         text,
  location_raw  text,
  city          text,
  salary_min    integer,
  salary_max    integer,
  posted_at     timestamptz,
  is_active     boolean default true,
  source        text,
  source_job_id text,
  source_url    text,
  content_hash  text unique,
  created_at    timestamptz default now()
);

-- Trigram index backing Job Role Search (`title ILIKE '%role%'`). See
-- migration 0003_job_title_search.sql.
create extension if not exists pg_trgm;
create index if not exists jobs_title_trgm
  on public.jobs using gin (title gin_trgm_ops);

-- Per-coach private metadata (RLS: coach_user_id = auth.uid()).
create table if not exists public.coach_company_meta (
  coach_user_id uuid not null,
  company_id    uuid not null references public.companies (id),
  starred       boolean default false,
  hidden        boolean default false,
  notes         text,
  unique (coach_user_id, company_id)
);

-- Outreach drafts / sent emails (RLS: coach_user_id = auth.uid()).
create table if not exists public.outreach_emails (
  id              uuid primary key default gen_random_uuid(),
  coach_user_id   uuid not null,
  company_id      uuid,
  recruiter_id    uuid,
  subject         text,
  body            text,
  status          text default 'draft',
  recipient_email text,
  sent_at         timestamptz,
  created_at      timestamptz default now()
);

-- 24h cache of normalized (query + location).
create table if not exists public.discovery_queries (
  id                uuid primary key default gen_random_uuid(),
  query             text not null,
  location          text not null,
  last_refreshed_at timestamptz not null default now(),
  created_at        timestamptz default now(),
  unique (query, location)
);

-- Crawl run records + statistics.
--
-- The columns the application actually reads and writes are listed first; see
-- migration 0005_crawl_run_stats_columns.sql. The live table uses
-- `started_at`/`completed_at` (not `created_at`/`finished_at`), and `status` is
-- 'running' → 'success' | 'error'. The trailing columns come from migrations
-- 0001/0002 and are no longer written — left in place, not dropped.
create table if not exists public.crawl_runs (
  id                       uuid primary key default gen_random_uuid(),
  source                   text,
  status                   text not null default 'running',
  query                    text,
  location                 text,
  started_at               timestamptz default now(),
  completed_at             timestamptz,
  error                    text,
  -- Per-run statistics, written in one UPDATE when the run finalizes and read
  -- back by the coach's "Crawl complete" screen.
  raw_jobs                 integer default 0,
  normalized_jobs          integer default 0,
  inserted_jobs            integer default 0,
  updated_jobs             integer default 0,
  duplicate_jobs           integer default 0,
  companies_created        integer default 0,
  companies_updated        integer default 0,
  -- Legacy, unwritten.
  jobs_fetched             integer default 0,
  new_jobs                 integer default 0,
  companies_discovered     integer default 0,
  lead_scores_recalculated integer default 0,
  created_at               timestamptz default now(),
  finished_at              timestamptz
);

-- Public view consumed by the student portal — only companies with active jobs.
create or replace view public.public_company_summary as
select
  c.id, c.slug, c.name, c.website, c.careers_url,
  c.sector, c.region, c.hq_location, c.lead_score,
  count(j.*) filter (where j.is_active) as open_jobs
from public.companies c
join public.jobs j on j.company_id = c.id and j.is_active = true
group by c.id;

-- Permanent company deletion (see migration 0004_company_permanent_delete.sql
-- for the body and the grants). One transaction:
--   jobs               → deleted   (shared crawler data)
--   coach_company_meta → deleted   (per-coach stars/notes/hidden, every coach)
--   outreach_emails    → unlinked  (company_id = null; coach content is kept)
--   companies          → deleted
-- Raises if any other table references companies.id. Executable by
-- `service_role` only — the API server, never the browser or a coach session.
-- create function public.delete_companies_permanently(p_company_ids uuid[])
--   returns jsonb language plpgsql security definer;
