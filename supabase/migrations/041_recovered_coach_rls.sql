-- Coach RLS recovered from the live career-hub database (dumped 2026-09-23).
--
-- These nine policies existed only on that project — no migration in either repo
-- creates them, so they could not be rebuilt from code. `034_ch0011` says as much
-- ("not visible here to safely replicate"). Dumped from `pg_policies` before the
-- project was paused; the wording below is that dump verbatim, not a rewrite.
--
-- They are the only thing protecting per-coach data: `anon` and `authenticated`
-- hold full table grants on `coach_company_meta` and `outreach_emails` (Supabase's
-- default), so RLS is the whole fence. Without these, every coach reads every
-- other coach's outreach drafts and nothing errors.
--
-- `drop policy if exists` first so this is safe to re-run and does not depend on
-- whether a policy of the same name arrived some other way.
--
-- Note: the live database had RLS enabled on 18 tables but policies on only
-- three. The other fifteen are deny-all for anon/authenticated and reachable only
-- through the service-role key — that is the intended shape, not an omission.

begin;

-- ── coach_company_meta: a coach sees only their own rows ────────────────────
drop policy if exists "coach can view own meta"   on public.coach_company_meta;
drop policy if exists "coach can insert own meta" on public.coach_company_meta;
drop policy if exists "coach can update own meta" on public.coach_company_meta;
drop policy if exists "coach can delete own meta" on public.coach_company_meta;

create policy "coach can view own meta"   on public.coach_company_meta
  as permissive for select to public using ((auth.uid() = coach_user_id));
create policy "coach can insert own meta" on public.coach_company_meta
  as permissive for insert to public with check ((auth.uid() = coach_user_id));
create policy "coach can update own meta" on public.coach_company_meta
  as permissive for update to public using ((auth.uid() = coach_user_id));
create policy "coach can delete own meta" on public.coach_company_meta
  as permissive for delete to public using ((auth.uid() = coach_user_id));

-- ── outreach_emails: same rule, this is the sensitive one ───────────────────
drop policy if exists "coach can view own outreach"   on public.outreach_emails;
drop policy if exists "coach can insert own outreach" on public.outreach_emails;
drop policy if exists "coach can update own outreach" on public.outreach_emails;
drop policy if exists "coach can delete own outreach" on public.outreach_emails;

create policy "coach can view own outreach"   on public.outreach_emails
  as permissive for select to public using ((auth.uid() = coach_user_id));
create policy "coach can insert own outreach" on public.outreach_emails
  as permissive for insert to public with check ((auth.uid() = coach_user_id));
create policy "coach can update own outreach" on public.outreach_emails
  as permissive for update to public using ((auth.uid() = coach_user_id));
create policy "coach can delete own outreach" on public.outreach_emails
  as permissive for delete to public using ((auth.uid() = coach_user_id));

-- ── jobs: the public half of the funnel. `026_ch0003` names this policy in a
--    comment but never creates it. ───────────────────────────────────────────
drop policy if exists "Public can read active jobs" on public.jobs;

create policy "Public can read active jobs" on public.jobs
  as permissive for select to anon, authenticated using ((is_active = true));

commit;

-- ── Catch-all sweep, same block as `011`. ──────────────────────────────────
-- `011` runs before career-hub's tables exist, so `crawl_runs` and
-- `discovery_queries` (created by `024`) never get RLS from it. Re-running the
-- sweep here, after every table exists, closes that gap and any future one.
do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and rowsecurity = false
  loop
    execute format('alter table public.%I enable row level security;', t.tablename);
    raise notice 'Enabled RLS on public.%', t.tablename;
  end loop;
end
$$;
