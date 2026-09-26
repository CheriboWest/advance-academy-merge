-- ============================================================================
--  044 — Cover Letter Generator joins the tool history
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--  Idempotent: safe to re-run.
--
--  `POST /api/cover-letter/generate` records each letter in `tool_results` so it
--  shows in History and counts as tool usage. The tool CHECK was last replaced
--  in 018a (cv, dream, interview, coaching); drop-then-add to widen it.
--  No new table, so no RLS change.
-- ============================================================================

alter table public.tool_results
  drop constraint if exists tool_results_tool_check;

alter table public.tool_results
  add constraint tool_results_tool_check
  check (tool in ('cv', 'dream', 'interview', 'coaching', 'cover_letter'));
