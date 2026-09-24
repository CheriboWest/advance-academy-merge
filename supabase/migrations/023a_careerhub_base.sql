-- CareerHub base tables — the part of career-hub's schema that predates its
-- numbered migrations.
--
-- Why this file exists: `024_ch0001` onward were written to run on career-hub's
-- *existing* database, so they only ever `alter table if exists` these three.
-- On a fresh project those alters are silent no-ops and the tables are never
-- created — `026_ch0003` is the first statement that actually fails, long after
-- the real gap. `careerhub/schema.sql` holds the definitions but is a reference
-- snapshot that must not be run wholesale (it also recreates `companies`, which
-- `001` owns).
--
-- `companies` is deliberately absent here: `001` creates it and `024_ch0001`
-- adds career-hub's columns onto it.

create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies (id),
  title         text,
  location_raw  text,
  city          text,
  -- `careerhub/schema.sql` says integer and the crawler's NormalizedJob types
  -- these as Optional[int], but career-hub's live table had drifted to numeric
  -- and holds fractional hourly rates — 238 of them. integer would round those
  -- away on any future import, and numeric costs nothing to accept ints.
  salary_min    numeric,
  salary_max    numeric,
  posted_at     timestamptz,
  is_active     boolean default true,
  source        text,
  source_job_id text,
  source_url    text,
  content_hash  text unique,
  created_at    timestamptz default now()
);

create table if not exists public.coach_company_meta (
  coach_user_id uuid not null,
  company_id    uuid not null references public.companies (id),
  starred       boolean default false,
  hidden        boolean default false,
  notes         text,
  unique (coach_user_id, company_id)
);

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

-- No policies here on purpose. RLS on with zero policies denies every anon and
-- authenticated read, which is the safe direction to be wrong in; `041` adds the
-- real per-coach policies recovered from the live database.
alter table public.jobs               enable row level security;
alter table public.coach_company_meta enable row level security;
alter table public.outreach_emails    enable row level security;
