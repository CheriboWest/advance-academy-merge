-- 008_company_additional_urls.sql
--
-- Migration: drop unused companies.linkedin_url and replace it with a proper
-- one-to-many table for the "Additional Links" field on the interview-prep
-- form. Each company can have up to 30 additional URLs (LinkedIn profile,
-- careers page, recruiter page, etc.). Cap is enforced via a BEFORE INSERT
-- trigger because Postgres has no native "max N rows per group" constraint.
--
-- Apply manually through the Supabase SQL editor (this project has no
-- migration CLI — see CLAUDE.md).

begin;

-- ── 1. Drop the unused linkedin_url column ─────────────────────────────────
-- All existing rows have linkedin_url = NULL, so this is non-destructive.
alter table public.companies
  drop column if exists linkedin_url;


-- ── 2. New table: company_additional_url ───────────────────────────────────
-- One row per URL. FK on the child side (standard one-to-many).
create table if not exists public.company_additional_url (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  url         text not null,
  ordinal     integer not null default 0,
  created_at  timestamptz not null default now(),

  -- Same URL cannot be saved twice for one company.
  constraint company_additional_url_unique_per_company
    unique (company_id, url),

  -- Hard cap on URL length. Matches the client-side validation limit
  -- (browsers practically refuse URLs > 2048 chars).
  constraint company_additional_url_url_length
    check (char_length(url) <= 2048),

  -- URL must be http(s). Cheap regex check; full parsing happens in app code.
  constraint company_additional_url_url_scheme
    check (url ~* '^https?://')
);

create index if not exists idx_company_additional_url_company
  on public.company_additional_url using btree (company_id);


-- ── 3. Enforce ≤ 30 URLs per company via trigger ───────────────────────────
create or replace function public.enforce_company_additional_url_limit()
returns trigger
language plpgsql
as $$
declare
  current_count integer;
begin
  select count(*) into current_count
  from public.company_additional_url
  where company_id = new.company_id;

  if current_count >= 30 then
    raise exception
      'company % already has the maximum of 30 additional URLs', new.company_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_company_additional_url_limit
  on public.company_additional_url;

create trigger trg_company_additional_url_limit
  before insert on public.company_additional_url
  for each row
  execute function public.enforce_company_additional_url_limit();


-- ── 4. RLS + grants (mirrors the existing companies table) ─────────────────
alter table public.company_additional_url enable row level security;

-- Companies are public-readable (see "Anyone can read companies" policy on
-- public.companies). Mirror that here so the frontend can read these rows.
drop policy if exists "Anyone can read company additional URLs"
  on public.company_additional_url;
create policy "Anyone can read company additional URLs"
  on public.company_additional_url for select
  using (true);

grant all on table public.company_additional_url to anon;
grant all on table public.company_additional_url to authenticated;
grant all on table public.company_additional_url to service_role;

commit;
