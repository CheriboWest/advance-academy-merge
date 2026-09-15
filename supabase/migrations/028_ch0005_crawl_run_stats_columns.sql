-- CareerHub UK — crawl_runs statistics columns
--
-- Additive and idempotent: every statement is `add column if not exists`, so
-- this is safe on a database that already has some or all of these columns and
-- on one that has none. No existing column, index, constraint, RLS policy or
-- row is modified.
--
-- Why this is needed
-- ------------------
-- The crawl pipeline counts raw/normalized/inserted/updated/duplicate jobs and
-- created/updated companies into a `CrawlStats` object, and the coach's "Crawl
-- complete" screen reads those counts back from the crawl's `crawl_runs` row.
-- The live table was created outside `infra/supabase/migrations/` and drifted
-- from the mirrored schema: it uses `started_at`/`completed_at` (not
-- `created_at`/`finished_at`) and was missing the per-run count columns
-- entirely. With nowhere to store them, the pipeline's finalize step wrote only
-- `status` + `completed_at`, the counts were discarded, and every finished
-- crawl reported zeros for work it had actually done.
--
-- This migration gives every column the application reads or writes a
-- guaranteed home. Columns from migrations 0001/0002 that the application no
-- longer writes (`jobs_fetched`, `new_jobs`, `companies_discovered`,
-- `lead_scores_recalculated`, `created_at`, `finished_at`) are deliberately
-- left untouched — dropping them is not required and would be destructive.

-- Run identity / lifecycle, as the application writes them.
alter table if exists public.crawl_runs
  add column if not exists source       text,
  add column if not exists query        text,
  add column if not exists location     text,
  add column if not exists started_at   timestamptz default now(),
  add column if not exists completed_at timestamptz,
  add column if not exists error        text;

-- Per-run statistics, as reported on the coach's crawl completion screen.
-- Defaulting to 0 means a row that has not been finalized reads as "nothing
-- counted yet" rather than NULL.
alter table if exists public.crawl_runs
  add column if not exists raw_jobs          integer default 0,
  add column if not exists normalized_jobs   integer default 0,
  add column if not exists inserted_jobs     integer default 0,
  add column if not exists updated_jobs      integer default 0,
  add column if not exists duplicate_jobs    integer default 0,
  add column if not exists companies_created integer default 0,
  add column if not exists companies_updated integer default 0;

-- `GET /discover/history` and the cache check both order by `started_at desc`,
-- and the cache check additionally filters on (query, location, status).
create index if not exists crawl_runs_started_at_idx
  on public.crawl_runs (started_at desc);

create index if not exists crawl_runs_query_location_idx
  on public.crawl_runs (query, location, started_at desc);
