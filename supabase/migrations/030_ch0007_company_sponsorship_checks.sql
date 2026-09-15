-- CareerHub UK — per-company sponsorship resolution state
--
-- Additive and idempotent. Creates one table; nothing in 0006 (the GOV.UK
-- register schema) is modified.
--
-- Why a second table
-- ------------------
-- `company_sponsorship` records a *link*: this company is that register row.
-- Its `sponsor_licence_id` is NOT NULL, which is deliberate — a row there is an
-- assertion of identity, and there is no such thing as a link to nothing.
--
-- But the resolver has three other outcomes that must also be remembered:
-- "no candidates existed", "candidates existed but were ambiguous", and "the
-- attempt failed". Without somewhere to put them, every crawl would re-resolve
-- every company that is not in the register — which is most of them — and the
-- ambiguous cases would leave no trace for review.
--
-- So resolution *state* lives here, one row per company, and resolution
-- *results* stay in `company_sponsorship`. Readers asking "is this company a
-- sponsor?" still consult `company_sponsorship_current` and nothing else.

create table if not exists public.company_sponsorship_checks (
  company_id uuid primary key references public.companies (id) on delete cascade,

  -- What the last completed attempt concluded. 'error' means the attempt did
  -- not complete — it is a state, not a finding about the company.
  last_decision text not null
    check (last_decision in ('match', 'ambiguous', 'no_match', 'error')),

  -- How many register rows the deterministic search offered. Zero means Claude
  -- was never called: there was nothing to resolve against.
  candidate_count integer not null default 0,

  -- Set only when last_decision = 'match'; the same licence the
  -- `company_sponsorship` row points at. Cleared if that register row is ever
  -- deleted, which must not delete the check itself.
  matched_licence_id uuid references public.sponsor_licences (id) on delete set null,

  -- Which register edition this conclusion was drawn against. A newer
  -- successful import makes the conclusion stale and the company eligible for
  -- rechecking — this is what stops a company being re-resolved on every crawl
  -- while still letting a refreshed register reopen the question.
  register_import_id uuid references public.sponsor_register_imports (id) on delete set null,

  attempts   integer not null default 0,
  error      text,
  checked_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "Which companies still need resolving" is the hot query for both the
-- post-crawl worker and the bulk backfill.
create index if not exists company_sponsorship_checks_stale_idx
  on public.company_sponsorship_checks (register_import_id, last_decision);
create index if not exists company_sponsorship_checks_checked_at_idx
  on public.company_sponsorship_checks (checked_at desc);

comment on table public.company_sponsorship_checks is
  'Per-company sponsorship resolution state: what the last attempt concluded '
  'and which register edition it was drawn against. Not a licence record — '
  'GOV.UK remains the source of truth and confirmed links live in '
  'company_sponsorship.';
comment on column public.company_sponsorship_checks.last_decision is
  'match | ambiguous | no_match | error. Only match implies a company_sponsorship row.';
