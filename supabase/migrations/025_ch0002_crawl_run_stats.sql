-- CareerHub UK — crawl_runs statistics columns (MVP-limited crawler)
--
-- Idempotent and additive. Adds the statistics the crawler now records:
-- raw_jobs, normalized_jobs, inserted_jobs, updated_jobs, duplicate_jobs,
-- companies_created, companies_updated. Older columns from 0001 are left in
-- place; the application writes and reads the columns below.

alter table if exists public.crawl_runs
  add column if not exists raw_jobs             integer default 0,
  add column if not exists normalized_jobs      integer default 0,
  add column if not exists inserted_jobs        integer default 0,
  add column if not exists updated_jobs         integer default 0,
  add column if not exists duplicate_jobs       integer default 0,
  add column if not exists companies_created    integer default 0,
  add column if not exists companies_updated    integer default 0;
