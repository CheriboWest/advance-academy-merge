-- CareerHub UK — company contacts
--
-- Additive and idempotent. Creates one table (`contacts`) and extends
-- `delete_companies_permanently` (migration 0004) to handle it explicitly.
-- Nothing existing is dropped or altered beyond that.
--
-- Ownership model
-- ----------------
-- A contact belongs to a company, not to the coach who added it — same as
-- `companies`/`jobs` (shared crawler data, "no per-coach ownership, exactly
-- as any coach may create them by running the crawler", per
-- app/routers/companies.py) and unlike `outreach_emails`/`coach_company_meta`
-- (per-coach). Any authenticated coach may view, add, edit or delete any
-- company's contacts.
--
-- Access model: backend-mediated, not direct-RLS
-- -------------------------------------------------
-- This project has no coach/student role anywhere (no JWT claim, no profiles
-- table — confirmed project-wide by the sponsorship milestone). `companies`/
-- `jobs`/`coach_company_meta`/`outreach_emails` predate the migrations
-- directory and their exact RLS is not visible here to safely replicate.
-- Contacts must never reach a student (requirement: never on public company
-- pages) and a student authenticates through the same Supabase project a
-- coach does, so an `authenticated`-wide RLS policy would not be safe to
-- write blind. Following the sponsorship tables' posture instead (migration
-- 0008): deny-by-default RLS, revoked from anon/authenticated, reachable
-- only through the FastAPI backend's service role key, which is the only
-- thing that applies the "authenticated session = coach" gate
-- (`get_current_user`). See app/routers/contacts.py.

create table if not exists public.contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,

  full_name    text not null,
  job_title    text,
  email        text,
  phone        text,
  linkedin_url text,
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A contact must be reachable some way: at least one of email/phone/
  -- LinkedIn. Enforced here as well as in the API (Pydantic) so a direct
  -- service-role write can't create an unreachable contact either.
  constraint contacts_has_contact_method check (
    email is not null or phone is not null or linkedin_url is not null
  ),
  constraint contacts_full_name_not_blank check (btrim(full_name) <> '')
);

-- "Contacts for this company" is the only access pattern the API has.
create index if not exists contacts_company_id_idx on public.contacts (company_id);

comment on table public.contacts is
  'Coach-managed contacts (recruiter/hiring manager etc.) for a company. '
  'Shared across coaches, like companies/jobs — not per-coach data. Backend- '
  'mediated only; never exposed to anon/authenticated directly (see RLS '
  'below) so it can never reach a public/student-facing page.';
comment on column public.contacts.job_title is 'Role/title at the company, e.g. "Hiring Manager".';

-- ---------------------------------------------------------------------------
-- RLS: deny by default, same posture as migration 0008's sponsorship tables.
-- ---------------------------------------------------------------------------
alter table if exists public.contacts enable row level security;

do $$
begin
  execute 'revoke all on public.contacts from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.contacts from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.contacts from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.contacts to service_role';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Extend delete_companies_permanently (0004) to handle the new FK.
--
-- Without this, permanently deleting a company with contacts would trip the
-- function's own "unhandled foreign key reference" guard and start failing —
-- a regression this migration must not introduce. Contacts are deleted along
-- with the company (same treatment as `jobs`): they have no standalone value
-- or audit-trail purpose independent of the company, unlike outreach_emails.
-- ---------------------------------------------------------------------------
create or replace function public.delete_companies_permanently(
  p_company_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids            uuid[];
  v_unhandled      text;
  v_deleted_ids    uuid[] := '{}';
  v_jobs           integer := 0;
  v_meta           integer := 0;
  v_outreach       integer := 0;
  v_contacts       integer := 0;
begin
  select coalesce(array_agg(distinct id), '{}')
    into v_ids
    from unnest(coalesce(p_company_ids, '{}'::uuid[])) as id
   where id is not null;

  if array_length(v_ids, 1) is null then
    return jsonb_build_object(
      'requested', 0,
      'deleted_companies', 0,
      'deleted_company_ids', '[]'::jsonb,
      'missing_company_ids', '[]'::jsonb,
      'deleted_jobs', 0,
      'deleted_coach_meta', 0,
      'unlinked_outreach_emails', 0,
      'deleted_contacts', 0
    );
  end if;

  select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by c.relname)
    into v_unhandled
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where con.contype = 'f'
     and con.confrelid = 'public.companies'::regclass
     and format('%I.%I', n.nspname, c.relname) not in (
       'public.jobs', 'public.coach_company_meta', 'public.outreach_emails',
       'public.contacts'
     );

  if v_unhandled is not null then
    raise exception
      'Refusing to delete companies: unhandled foreign key reference(s) from %. '
      'Extend delete_companies_permanently() to handle them explicitly.',
      v_unhandled
      using errcode = 'foreign_key_violation';
  end if;

  update public.outreach_emails
     set company_id = null
   where company_id = any (v_ids);
  get diagnostics v_outreach = row_count;

  delete from public.jobs where company_id = any (v_ids);
  get diagnostics v_jobs = row_count;

  delete from public.coach_company_meta where company_id = any (v_ids);
  get diagnostics v_meta = row_count;

  delete from public.contacts where company_id = any (v_ids);
  get diagnostics v_contacts = row_count;

  with removed as (
    delete from public.companies where id = any (v_ids) returning id
  )
  select coalesce(array_agg(id), '{}') into v_deleted_ids from removed;

  return jsonb_build_object(
    'requested', array_length(v_ids, 1),
    'deleted_companies', coalesce(array_length(v_deleted_ids, 1), 0),
    'deleted_company_ids', to_jsonb(v_deleted_ids),
    'missing_company_ids', to_jsonb(
      array(select id from unnest(v_ids) as id where not (id = any (v_deleted_ids)))
    ),
    'deleted_jobs', v_jobs,
    'deleted_coach_meta', v_meta,
    'unlinked_outreach_emails', v_outreach,
    'deleted_contacts', v_contacts
  );
end;
$$;

comment on function public.delete_companies_permanently(uuid[]) is
  'Permanently deletes companies and their jobs + coach_company_meta + '
  'contacts in one transaction, unlinking (never deleting) outreach_emails. '
  'service_role only.';
