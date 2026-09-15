-- CareerHub UK — UK Register of Licensed Sponsors (Workers)
--
-- Additive and idempotent. Creates three new tables; no existing table, column,
-- index, constraint, RLS policy or row is modified.
--
-- Source of truth
-- ---------------
-- GOV.UK's "Register of licensed sponsors: workers" is the ONLY authority for
-- whether an organisation currently holds a sponsor licence. These tables store
-- that register verbatim plus a normalized form used for candidate lookup.
-- Nothing here infers, extends, or backdates a licence.
--
--   sponsor_licences        one row per register line, with provenance
--   sponsor_register_imports one row per ingestion run, with statistics
--   company_sponsorship     a resolved link between a crawled company and a
--                           register row — an assertion ABOUT the register, never
--                           a substitute for it
--
-- The register row and the company row stay separate on purpose: a company is
-- something we crawled, a licence is something the Home Office published, and
-- conflating them would let a resolution mistake masquerade as licence status.

-- ---------------------------------------------------------------------------
-- sponsor_licences — the register itself
-- ---------------------------------------------------------------------------
create table if not exists public.sponsor_licences (
  id uuid primary key default gen_random_uuid(),

  -- Verbatim GOV.UK values. Never rewritten by normalization.
  organisation_name text not null,
  town_city         text,
  county            text,
  type_rating       text,        -- e.g. "Worker (A rating)" exactly as published
  route             text,        -- e.g. "Skilled Worker"

  -- Parsed out of `type_rating` for querying. Null when the published value does
  -- not follow the "<type> (<rating> rating)" shape — we do not guess.
  licence_type text,
  rating       text,

  -- Normalized forms, used only for candidate lookup. Derived, never displayed
  -- in place of the originals.
  normalized_name text not null,
  normalized_town text,

  -- Identity of a register line: the same organisation appears once per
  -- (town, county, type & rating, route) combination, so all of them together
  -- form the natural key. Hashed so the unique index stays narrow.
  natural_key text not null,

  -- Provenance — every row can be traced back to the file it came from.
  source_url            text not null,
  register_published_at date,       -- the register's own publication date
  imported_at           timestamptz not null default now(),

  -- Current-status handling. A row that stops appearing in the register is
  -- marked `is_current = false` and kept: absence from a newer file means the
  -- licence is no longer listed today, NOT that it never existed.
  is_current   boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  withdrawn_at  timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sponsor_licences_natural_key_idx
  on public.sponsor_licences (natural_key);

-- Candidate lookup: exact and prefix matching on the normalized name, narrowed
-- by town. `text_pattern_ops` makes `like 'acme%'` index-backed.
create index if not exists sponsor_licences_normalized_name_idx
  on public.sponsor_licences (normalized_name text_pattern_ops);
create index if not exists sponsor_licences_normalized_town_idx
  on public.sponsor_licences (normalized_town);
create index if not exists sponsor_licences_current_idx
  on public.sponsor_licences (is_current) where is_current;

-- Fuzzy fallback when the normalized names differ by more than punctuation.
create extension if not exists pg_trgm;
create index if not exists sponsor_licences_name_trgm_idx
  on public.sponsor_licences using gin (normalized_name gin_trgm_ops);

comment on column public.sponsor_licences.organisation_name is
  'Verbatim GOV.UK organisation name. Never overwritten by normalization.';
comment on column public.sponsor_licences.is_current is
  'True while the row appears in the most recent register import. Set false '
  '(never deleted) when it stops appearing.';

-- ---------------------------------------------------------------------------
-- sponsor_register_imports — one row per ingestion run
-- ---------------------------------------------------------------------------
create table if not exists public.sponsor_register_imports (
  id uuid primary key default gen_random_uuid(),

  source_url            text,
  register_published_at date,
  status                text not null default 'running',  -- running | success | error

  rows_downloaded integer not null default 0,
  rows_parsed     integer not null default 0,
  rows_inserted   integer not null default 0,
  rows_updated    integer not null default 0,
  rows_unchanged  integer not null default 0,
  rows_rejected   integer not null default 0,
  rows_withdrawn  integer not null default 0,

  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists sponsor_register_imports_started_at_idx
  on public.sponsor_register_imports (started_at desc);

-- ---------------------------------------------------------------------------
-- company_sponsorship — a resolved link, kept apart from both sides
-- ---------------------------------------------------------------------------
create table if not exists public.company_sponsorship (
  id uuid primary key default gen_random_uuid(),

  company_id         uuid not null references public.companies (id) on delete cascade,
  sponsor_licence_id uuid not null references public.sponsor_licences (id) on delete cascade,

  -- Only 'match' asserts that these are the same organisation. 'ambiguous' is
  -- recorded so a human can review it and is NEVER treated as a sponsorship
  -- link by any reader.
  decision   text not null check (decision in ('match', 'ambiguous', 'no_match')),
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),

  -- Which signals supported the decision, e.g. {name_exact, town, domain}.
  matched_on text[] not null default '{}',
  reasoning  text,

  resolved_by text not null default 'claude',  -- claude | manual
  model       text,
  resolved_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A company may legitimately link to several register rows (multiple routes or
-- sites), but only once per row.
create unique index if not exists company_sponsorship_pair_idx
  on public.company_sponsorship (company_id, sponsor_licence_id);
create index if not exists company_sponsorship_company_idx
  on public.company_sponsorship (company_id);
create index if not exists company_sponsorship_decision_idx
  on public.company_sponsorship (decision);

comment on table public.company_sponsorship is
  'Entity-resolution output linking a crawled company to a register row. '
  'GOV.UK remains the source of truth for licence status; a row here only '
  'claims the two records describe the same organisation.';

-- ---------------------------------------------------------------------------
-- Confirmed sponsorship, for readers that must not see unresolved guesses.
-- ---------------------------------------------------------------------------
create or replace view public.company_sponsorship_current as
select
  cs.company_id,
  cs.sponsor_licence_id,
  cs.confidence,
  cs.matched_on,
  cs.resolved_at,
  sl.organisation_name,
  sl.town_city,
  sl.county,
  sl.route,
  sl.licence_type,
  sl.rating,
  sl.source_url,
  sl.register_published_at
from public.company_sponsorship cs
join public.sponsor_licences sl on sl.id = cs.sponsor_licence_id
where cs.decision = 'match'
  and sl.is_current;
