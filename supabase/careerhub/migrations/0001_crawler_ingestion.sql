-- CareerHub UK — Coach-triggered crawler & shared ingestion
--
-- Idempotent and additive: safe to run on the existing database (which already
-- has companies, jobs, crawl_runs, coach_company_meta, outreach_emails and the
-- public_company_summary view) as well as a fresh one.

-- ---------------------------------------------------------------------------
-- companies: description for enrichment
-- ---------------------------------------------------------------------------
alter table if exists public.companies
  add column if not exists description text;

-- Columns the ingestion relies on (no-ops if they already exist).
alter table if exists public.companies
  add column if not exists slug        text,
  add column if not exists name        text,
  add column if not exists website     text,
  add column if not exists careers_url text,
  add column if not exists sector      text,
  add column if not exists region      text,
  add column if not exists hq_location text,
  add column if not exists lead_score  integer default 0;

create unique index if not exists companies_slug_key on public.companies (slug);

-- ---------------------------------------------------------------------------
-- jobs: crawler/dedup columns
-- ---------------------------------------------------------------------------
alter table if exists public.jobs
  add column if not exists company_id    uuid,
  add column if not exists title         text,
  add column if not exists location_raw  text,
  add column if not exists city          text,
  add column if not exists salary_min    integer,
  add column if not exists salary_max    integer,
  add column if not exists posted_at     timestamptz,
  add column if not exists is_active     boolean default true,
  add column if not exists source        text,
  add column if not exists source_job_id text,
  add column if not exists source_url    text,
  add column if not exists content_hash  text;

-- Deduplication key (the "existing content_hash strategy").
create unique index if not exists jobs_content_hash_key on public.jobs (content_hash);

-- ---------------------------------------------------------------------------
-- discovery_queries: 24h cache of normalized (query + location)
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_queries (
  id                uuid primary key default gen_random_uuid(),
  query             text not null,
  location          text not null,
  last_refreshed_at timestamptz not null default now(),
  created_at        timestamptz default now(),
  unique (query, location)
);

-- ---------------------------------------------------------------------------
-- crawl_runs: create if missing, then extend with the new columns
-- ---------------------------------------------------------------------------
create table if not exists public.crawl_runs (
  id         uuid primary key default gen_random_uuid(),
  status     text not null default 'running',
  created_at timestamptz default now()
);

alter table if exists public.crawl_runs
  add column if not exists query                   text,
  add column if not exists location                text,
  add column if not exists jobs_fetched            integer default 0,
  add column if not exists new_jobs                integer default 0,
  add column if not exists duplicate_jobs          integer default 0,
  add column if not exists companies_discovered    integer default 0,
  add column if not exists companies_updated       integer default 0,
  add column if not exists lead_scores_recalculated integer default 0,
  add column if not exists error                   text,
  add column if not exists finished_at             timestamptz;

-- ---------------------------------------------------------------------------
-- public_company_summary: students only see companies with >=1 active job
-- ---------------------------------------------------------------------------
create or replace view public.public_company_summary as
select
  c.id,
  c.slug,
  c.name,
  c.website,
  c.careers_url,
  c.sector,
  c.region,
  c.hq_location,
  c.lead_score,
  count(j.*) filter (where j.is_active) as open_jobs
from public.companies c
join public.jobs j
  on j.company_id = c.id
 and j.is_active = true
group by c.id;
