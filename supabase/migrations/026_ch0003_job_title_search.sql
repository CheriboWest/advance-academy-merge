-- CareerHub UK — Job Role Search support
--
-- Additive and idempotent. Job Role Search matches active jobs by title with a
-- case-insensitive substring query (`title ILIKE '%role%'`). A leading-wildcard
-- ILIKE cannot use a normal B-tree index, so without support it degrades to a
-- sequential scan on `jobs`. A pg_trgm GIN index makes that ILIKE index-backed.
--
-- This migration only adds an extension and an index — no data or schema of
-- existing tables/columns changes, and the RLS policy on `public.jobs`
-- ("Public can read active jobs") is untouched. The feature is correct without
-- this index; the index is purely for performance at scale.

create extension if not exists pg_trgm;

create index if not exists jobs_title_trgm
  on public.jobs using gin (title gin_trgm_ops);
