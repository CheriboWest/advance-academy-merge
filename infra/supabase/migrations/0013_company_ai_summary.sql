-- CareerHub UK — company AI summary
--
-- Additive and idempotent. Adds a stored, short (2-4 sentence) company
-- summary shown to both students and coaches, generated at write time
-- (company creation / crawl enrichment / manual refresh) rather than on
-- every page render — see app/companies/summarizer.py.
--
-- Not the existing `description` column
-- ----------------------------------------
-- `companies.description` (migration 0001) already exists and is populated
-- best-effort from a scraped <meta name="description">/og:description tag
-- (app/crawler/enrich.py) — raw marketing copy from the company's own
-- website, of unpredictable length and tone, and never actually surfaced
-- anywhere in the app (`public_company_summary`, below, never selected it).
-- `ai_summary` is a deliberately separate column: a short, structured,
-- factual summary generated FROM this platform's own stored data (name,
-- sector, location, current jobs, confirmed sponsorship), grounded and
-- length-controlled, not a redisplay of whatever the company's own site
-- happens to say about itself. Neither column is touched by the other.

alter table if exists public.companies
  add column if not exists ai_summary text,
  add column if not exists ai_summary_generated_at timestamptz;

comment on column public.companies.ai_summary is
  'Short (2-4 sentence) factual summary generated from stored company data '
  '(name/sector/location/jobs/confirmed sponsorship) - AI-authored when '
  'there is enough data, a deterministic template otherwise (see '
  'app/companies/summarizer.py). Never generated at page-render time.';
comment on column public.companies.ai_summary_generated_at is
  'When ai_summary was last (re)generated - company creation, post-crawl '
  'enrichment, or a coach''s manual refresh.';

-- Both the public student-facing page and the coach Sponsored Company page
-- read company data through this view, so the summary has to be exposed
-- here to reach either one. Additive: appends two columns to the existing
-- select list, changes nothing already returned.
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
