-- ============================================================================
--  021 — user_engagement RPC (admin users list)
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
--  Idempotent: safe to re-run.
--
--  /admin/users could previously say only "has this account ever used a tool"
--  — one tick, read from users.first_tool_used_at. That cannot tell an account
--  that signed up months ago and ran one thing from one that ran a dozen this
--  week, which is exactly the distinction an admin needs to decide who is worth
--  a coach's hour.
--
--  Doing it per row is not an option: the list returns up to 500 accounts, and
--  PostgREST cannot GROUP BY, so the alternative was 500 round trips. This
--  function answers for a whole page in one call.
--
--  Requires migration 019 (coaching_sessions). If 019 has not been applied the
--  CREATE below fails on the missing table — apply 019 first. The backend
--  tolerates this function being absent (the two columns render as "—"), so a
--  deploy that outruns this migration degrades rather than breaks.
-- ============================================================================

-- Drop any prior signature so re-runs replace cleanly.
drop function if exists public.user_engagement(uuid[]);

-- user_engagement: activity totals for a batch of accounts.
--
-- "Activity" deliberately spans all three things a student can do — run a tool,
-- sit an interview, book coaching — because any one of them alone understates
-- engagement. A student mid-coaching may not have touched a tool in weeks.
create function public.user_engagement(user_ids uuid[])
returns table (
  user_id        uuid,
  last_active_at timestamptz,
  events_30d     integer,
  total_events   integer
)
language sql
stable
-- security invoker (the default), NOT definer: the three source tables are
-- backend-only with RLS and no policies, so the service role reads them and the
-- anon key gets nothing. A definer function here would hand anon an aggregate
-- view of data it must never see.
as $$
  with events as (
    select tr.user_id, tr.created_at as at
      from public.tool_results tr
     where tr.user_id = any(user_ids)
    union all
    -- started_at is when the person actually did something; created_at is only
    -- when the row appeared, and the two differ for resumed sessions.
    select s.user_id, coalesce(s.started_at, s.created_at) as at
      from public.interview_sessions s
     where s.user_id = any(user_ids)
    union all
    select c.student_id as user_id, c.created_at as at
      from public.coaching_sessions c
     where c.student_id = any(user_ids)
  )
  select
    e.user_id,
    max(e.at)                                                             as last_active_at,
    (count(*) filter (where e.at >= now() - interval '30 days'))::integer as events_30d,
    count(*)::integer                                                     as total_events
  from events e
  where e.user_id is not null
  group by e.user_id;
$$;

-- Belt and braces alongside RLS: PostgREST exposes functions to the anon and
-- authenticated roles by default, and this one has no business being callable
-- by either.
--
-- Revoked from those two roles by name rather than from PUBLIC: service_role is
-- not a superuser, so it holds EXECUTE through the same default PUBLIC grant.
-- Revoking PUBLIC would take the function away from the backend as well, and the
-- symptom — two columns quietly reading "never"/0 for everyone — looks exactly
-- like "nobody has used anything".
revoke execute on function public.user_engagement(uuid[]) from anon, authenticated;
grant execute on function public.user_engagement(uuid[]) to service_role;

-- Verify after running:
--   select * from public.user_engagement(
--     array(select id from public.users limit 5)
--   );
--   -- expect one row per account that has any activity; accounts with none are
--   -- simply absent, which the backend reads as zero.
