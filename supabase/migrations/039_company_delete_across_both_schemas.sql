-- ============================================================================
--  039 — let delete_companies_permanently() see AdvanceAcademyTools' tables
--  Run in Supabase SQL Editor. Idempotent: safe to re-run.
--
--  career-hub's 027_ch0004 guards against silent data loss: before deleting a
--  company it looks for any foreign key into public.companies it does not
--  explicitly handle, and raises rather than guess. Sound design — and it fires
--  the moment both schemas share one database, because AdvanceAcademyTools adds
--  four such references. Without this migration the coach UI's "delete
--  permanently" fails on the very first click with:
--
--    Refusing to delete companies: unhandled foreign key reference(s) from
--    public.company_additional_url, public.company_research_reports,
--    public.job_targets, public.question_bank_entries.
--
--  The fix is only the allowlist. Every one of those four already declares its
--  own ON DELETE behaviour (cascade or set null), so Postgres does the work
--  when the company row goes; re-deleting them inside the function would
--  duplicate the schema's own rules and let the two drift apart. What the guard
--  wants is a deliberate decision, and the decision is "the declared action is
--  already right" - recorded in the comments below.
--
--  Two more were missed on the first pass and found by actually clicking the
--  button (2026-09-24): company_sponsorship and company_sponsorship_checks are
--  career-hub's own, added by 029 and 030 — after 027 wrote the guard. So this
--  was never purely a merge problem: career-hub's delete button would refuse on
--  its own database too. Nobody noticed because its coach UI was barely used —
--  coach_company_meta held zero rows at the time of the migration.
--
--  Depends on: 027_ch0004, 034_ch0011 (this replaces that version of the
--  function), 001 and 008 (the AdvanceAcademyTools references), 029 and 030
--  (the sponsorship ones).
-- ============================================================================

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
       'public.contacts',
       -- AdvanceAcademyTools tables (migrations 001 and 008). Each already
       -- declares the on-delete action this function would otherwise have to
       -- repeat by hand, so listing them here is the whole fix:
       --   company_research_reports  on delete cascade   (research about the
       --     company; has no meaning once the company is gone)
       --   company_additional_url    on delete cascade   (likewise)
       --   job_targets               on delete set null  (a student's target
       --     survives; it just loses the company link)
       --   question_bank_entries     on delete set null  (likewise - a coach
       --     deleting a company must not delete interview history)
       'public.company_research_reports', 'public.company_additional_url',
       'public.job_targets', 'public.question_bank_entries',
       -- career-hub's own sponsorship tables, added by 029 and 030 — i.e. after
       -- 027 wrote the guard, which is why its author never listed them. Same
       -- reasoning as the four above: both declare ON DELETE CASCADE, so the
       -- company row going away already removes them.
       --   company_sponsorship         on delete cascade  (a resolved link to a
       --     sponsor licence; meaningless once the company is gone)
       --   company_sponsorship_checks  on delete cascade  (one row of
       --     resolution state per company)
       'public.company_sponsorship', 'public.company_sponsorship_checks'
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
  'References from AdvanceAcademyTools (company_research_reports, '
  'company_additional_url, job_targets, question_bank_entries) and from '
  'career-hub sponsorship (company_sponsorship, company_sponsorship_checks) '
  'resolve via their own ON DELETE actions. service_role only.';
