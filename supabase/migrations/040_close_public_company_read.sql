-- ============================================================================
--  040 — stop serving companies straight to the anon key
--  Run in Supabase SQL Editor. Idempotent: safe to re-run.
--
--  Migration 001 gave public.companies an open read policy:
--
--    create policy "Anyone can read companies" on companies for select
--      using (true);
--
--  and 008 mirrored it onto company_additional_url, "so the frontend can read
--  these rows". That was proportionate when the table held only the handful of
--  companies Interview Prep created (name, website, research_status).
--
--  It stops being proportionate the moment 024_ch0001 lands: the same table
--  then carries career-hub's crawl - lead_score, ai_summary, sector, region,
--  careers_url, sponsorship links - for every company ever crawled. Left as is,
--  the anon key (which ships in the browser bundle, by design) would serve the
--  whole commercial dataset to anyone who opened devtools.
--
--  Nothing needs these policies:
--    - career-hub's public pages read the `public_company_summary` view, never
--      the table (verified in careerhub/apps/web/lib/queries.ts - every call is
--      .from("public_company_summary")). The view is SECURITY INVOKER as of
--      031_ch0008 and deliberately exposes only companies with >= 1 active job.
--    - AdvanceAcademyTools' frontend never queries a table at all; its browser
--      Supabase client is used purely for auth (shared/auth/supabase-browser.ts),
--      and every read goes through Fastify on the service role.
--
--  So this is a pure subtraction: no caller loses anything.
--
--  Also revokes 008's `grant all ... to anon/authenticated`. RLS already blocks
--  the writes that grant would otherwise permit, but two things have to stay
--  wrong for that to hold. One is enough.
-- ============================================================================

begin;

drop policy if exists "Anyone can read companies"
  on public.companies;

drop policy if exists "Anyone can read company additional URLs"
  on public.company_additional_url;

-- Match the deny-by-default posture 031_ch0008 uses for the sponsorship tables:
-- reachable through the service role only. Guarded on role existence so this
-- runs on a local database that has no Supabase roles.
do $$
declare
  t text;
begin
  foreach t in array array['public.companies', 'public.company_additional_url']
  loop
    execute format('revoke all on table %s from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %s from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %s from authenticated', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on table %s to service_role', t);
    end if;
  end loop;
end
$$;

commit;
