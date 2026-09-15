-- CareerHub UK — permanent company deletion
--
-- Adds `public.delete_companies_permanently(uuid[])`: a single-transaction,
-- SECURITY DEFINER function that permanently removes companies and their
-- dependent rows. Additive and idempotent — no existing table, column, index,
-- foreign key, or RLS policy is changed.
--
-- Why a function rather than DELETEs from the app:
--
--   1. Atomicity. `companies` is referenced by `jobs` and `coach_company_meta`
--      with ON DELETE NO ACTION, so the dependents must be removed first. Over
--      PostgREST that is several separate statements, each its own transaction:
--      a failure halfway through leaves a company with no jobs, or jobs with no
--      company. A plpgsql function runs as one transaction — all of it commits,
--      or none of it does.
--   2. Explicitness. Every dependent table is handled by name below, so
--      deletion never depends on cascade behaviour that happens to be
--      configured (or not) on the live database.
--   3. Least privilege. Only `service_role` may execute it (see the GRANTs at
--      the bottom): the browser and the coach's `authenticated` session cannot,
--      so the destructive path exists only behind the authenticated API.
--
-- Data ownership decisions encoded here:
--
--   * `jobs`               — shared crawler data, meaningless without the
--                            company. DELETED.
--   * `coach_company_meta` — per-coach stars/notes/hidden for that company,
--                            meaningless without the company, and its FK
--                            forbids leaving it behind. DELETED for every
--                            coach, not just the caller.
--   * `outreach_emails`    — coach-authored drafts and the record of mail that
--                            was actually sent. NOT deleted: the link is
--                            cleared (`company_id = null`) so the coach keeps
--                            their own content and audit trail.
--
-- Any *other* table that references `companies.id` is deliberately NOT guessed
-- at: the function raises and rolls back, naming the table, so an unhandled
-- relationship is a loud failure instead of silent data loss.

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
begin
  -- Validate + deduplicate. NULL entries are dropped rather than treated as a
  -- match-anything wildcard.
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
      'unlinked_outreach_emails', 0
    );
  end if;

  -- Refuse to run if some table references companies.id that this function
  -- does not handle explicitly. Deleting the parent would either fail on that
  -- constraint anyway or, if it were configured to cascade, silently destroy
  -- rows nobody audited.
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by c.relname)
    into v_unhandled
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where con.contype = 'f'
     and con.confrelid = 'public.companies'::regclass
     and format('%I.%I', n.nspname, c.relname) not in (
       'public.jobs', 'public.coach_company_meta', 'public.outreach_emails'
     );

  if v_unhandled is not null then
    raise exception
      'Refusing to delete companies: unhandled foreign key reference(s) from %. '
      'Extend delete_companies_permanently() to handle them explicitly.',
      v_unhandled
      using errcode = 'foreign_key_violation';
  end if;

  -- Coach-authored outreach survives the company; only the link is cleared.
  -- Done before the parent delete so it also satisfies an FK on this column if
  -- the live database has one (the mirrored schema does not).
  update public.outreach_emails
     set company_id = null
   where company_id = any (v_ids);
  get diagnostics v_outreach = row_count;

  delete from public.jobs where company_id = any (v_ids);
  get diagnostics v_jobs = row_count;

  delete from public.coach_company_meta where company_id = any (v_ids);
  get diagnostics v_meta = row_count;

  with removed as (
    delete from public.companies where id = any (v_ids) returning id
  )
  select coalesce(array_agg(id), '{}') into v_deleted_ids from removed;

  return jsonb_build_object(
    'requested', array_length(v_ids, 1),
    'deleted_companies', coalesce(array_length(v_deleted_ids, 1), 0),
    'deleted_company_ids', to_jsonb(v_deleted_ids),
    -- Ids that matched no row: already gone, or never existed. Reported so the
    -- caller can say so explicitly instead of implying a full success.
    'missing_company_ids', to_jsonb(
      array(select id from unnest(v_ids) as id where not (id = any (v_deleted_ids)))
    ),
    'deleted_jobs', v_jobs,
    'deleted_coach_meta', v_meta,
    'unlinked_outreach_emails', v_outreach
  );
end;
$$;

comment on function public.delete_companies_permanently(uuid[]) is
  'Permanently deletes companies and their jobs + coach_company_meta in one '
  'transaction, unlinking (never deleting) outreach_emails. service_role only.';

-- Least privilege: revoke the implicit PUBLIC execute grant, then hand it only
-- to service_role, which lives exclusively in the API server's environment.
-- `authenticated` (a coach's browser session) deliberately cannot call this.
revoke all on function public.delete_companies_permanently(uuid[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.delete_companies_permanently(uuid[]) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.delete_companies_permanently(uuid[]) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.delete_companies_permanently(uuid[]) to service_role';
  end if;
end
$$;
