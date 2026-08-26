-- CareerHub UK — repair public_company_summary if 0013 never (fully) landed
--
-- Root cause of "column public_company_summary.ai_summary does not exist"
-- on the coach Sponsored Companies page: migration 0013 already adds
-- `companies.ai_summary`/`ai_summary_generated_at` AND recreates
-- `public_company_summary` to expose them, in one migration — but a
-- database can only be missing that column combination if 0013 was never
-- run against it (or a migration tool's history table marked it "applied"
-- without every statement actually landing). This is not a code defect:
-- apps/web/lib/coach.ts's SPONSORED_COMPANY_COLUMNS and 0013's view
-- definition already agree with each other (see
-- test_public_company_summary_view.py, added alongside this migration,
-- which statically checks that going forward).
--
-- This migration makes the fix independent of whatever state 0013 is
-- believed to be in on a given database: every statement below is the
-- same idempotent shape 0013 already used (`add column if not exists`,
-- `create or replace view`), so running it is a no-op wherever 0013 did
-- take effect, and the actual fix wherever it didn't. Getting a fresh
-- migration number matters operationally even though the SQL is
-- unchanged: a migration tool that already has 0013 recorded as applied
-- won't re-run it just because the database disagrees, but it will run a
-- migration it hasn't seen before.
--
-- Preserves every existing view column and adds none beyond what 0013
-- already specified; no RLS or grants exist on this view for either
-- migration to touch (companies/jobs, the tables it reads, carry the
-- access control, not the view itself).

alter table if exists public.companies
  add column if not exists ai_summary text,
  add column if not exists ai_summary_generated_at timestamptz;

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
  c.ai_summary,
  c.ai_summary_generated_at,
  count(j.*) filter (where j.is_active) as open_jobs
from public.companies c
join public.jobs j
  on j.company_id = c.id
 and j.is_active = true
group by c.id;
