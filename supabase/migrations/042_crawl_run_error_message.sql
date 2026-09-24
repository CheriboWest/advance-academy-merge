-- The two `crawl_runs` columns the crawler actually writes.
--
-- career-hub's live table and its migrations disagree on two names, and the
-- code was written against the live shape both times. A database built from the
-- migrations therefore lacks both columns:
--
--   error_message   migrations add `error`        (024_ch0001, 028_ch0005)
--   jobs_found      migrations add `jobs_fetched` (024_ch0001)
--
-- All three code sites say so outright:
--
--   crawler/pipeline.py:522  "The live column is `error_message`, NOT `error`."
--   routers/discover.py:69   "reading `error` (which does not exist) always
--                             yielded None, so a coach never saw why a crawl
--                             failed."
--   crawler/models.py:161    "`jobs_verified` is written to `jobs_found` — an
--                             existing column, not one this codebase's own
--                             migrations ever defined (0001 has `jobs_fetched`,
--                             not `jobs_found`), but confirmed live twice over."
--
-- Why this is worth a migration rather than changing the code to match the
-- migrations: the live shape is what the eventual cutover inherits, so moving
-- the code would have to be undone later.
--
-- The failure mode is quiet. A PostgREST UPDATE is all-or-nothing, so one
-- unknown column fails the whole statement (PGRST204); `_finalize`'s tiered
-- write then narrows until something lands, and the run still reports success
-- with its statistics silently dropped. Observed on 2026-09-24: a crawl that
-- ingested 100 raw jobs and inserted 43 displayed 0/0/0/0, and after fixing
-- only `error_message` it displayed 32/68/3 with "jobs verified" still 0.
--
-- `error` and `jobs_fetched` are left in place. Nothing reads or writes either,
-- but dropping columns is not worth the risk here; this comment is the warning.

alter table if exists public.crawl_runs
  add column if not exists error_message text,
  add column if not exists jobs_found    integer;

comment on column public.crawl_runs.error_message is
  'Failure text for a crawl run. The crawler writes this, not `error` — see 042.';

comment on column public.crawl_runs.jobs_found is
  'Jobs verified against their source during the run. The crawler writes this, '
  'not `jobs_fetched` — see 042.';
