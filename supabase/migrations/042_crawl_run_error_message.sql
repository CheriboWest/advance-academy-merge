-- crawl_runs.error_message — the column the crawler actually writes.
--
-- `024_ch0001` and `028_ch0005` both add `error`, but career-hub's live table
-- never had that column; it had `error_message`, and the code was written
-- against the live shape. Both sites say so in comments:
--
--   crawler/pipeline.py:522  "The live column is `error_message`, NOT `error`."
--   routers/discover.py:69   "reading `error` (which does not exist) always
--                             yielded None, so a coach never saw why a crawl
--                             failed."
--
-- So a database built from these migrations is missing it, and finalize fails:
-- PostgREST rejects every tier with PGRST204, the narrowing logic falls back to
-- `{status, completed_at}`, and the whole stats payload is dropped. The crawl
-- itself succeeds — jobs and companies land — but the UI reads back zeros for
-- new jobs, duplicates and companies created. Found exactly that way on
-- 2026-09-24: a run that ingested 100 raw jobs and inserted 43 displayed 0/0/0.
--
-- `error` is left in place. Nothing reads or writes it, but dropping a column
-- is not worth the risk here; the comment above is the warning.

alter table if exists public.crawl_runs
  add column if not exists error_message text;

comment on column public.crawl_runs.error_message is
  'Failure text for a crawl run. The crawler writes this column, not `error` — '
  'see migration 042.';
