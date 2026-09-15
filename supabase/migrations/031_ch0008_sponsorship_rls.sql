-- CareerHub UK — lock the sponsorship tables down (deny by default)
--
-- Additive and idempotent. Creates no tables and changes no data; it only
-- restricts access.
--
-- Why
-- ---
-- Migrations 0006 and 0007 created four tables in the `public` schema without
-- enabling row level security. Supabase exposes `public` through PostgREST and
-- grants `anon`/`authenticated` table privileges by default, so as published
-- those tables were readable by anyone holding the anon key — which ships to
-- every browser. That would have exposed which companies hold sponsor licences,
-- and the resolver's reasoning, to any visitor.
--
-- Posture for this milestone: NOBODY reads these tables through PostgREST.
--
--   anon           → denied (no privileges, and no policy would grant rows)
--   authenticated  → denied (same)
--   service_role   → unaffected; it bypasses RLS and keeps its privileges
--
-- There is deliberately NO `to authenticated using (true)` policy. Being signed
-- in is not the same as being a coach: students authenticate too, and
-- sponsorship data is a paid entitlement whose rules do not exist yet. A
-- blanket policy would hand it to every authenticated account the day the
-- entitlement layer ships late.
--
-- Access will be granted later through the FastAPI backend, which already holds
-- the service role key and can apply explicit coach/student entitlement checks
-- per request. Read paths are added there, not here.
--
-- Both mechanisms are applied on purpose. RLS decides which ROWS a role may
-- see; a GRANT decides whether the role may touch the TABLE at all. Enabling
-- RLS without revoking privileges leaves the table reachable and relies solely
-- on there being no permissive policy — one careless policy later would open it.
-- Revoking without RLS leaves it open to any role that gains a grant. Neither
-- alone is sufficient.

-- ---------------------------------------------------------------------------
-- 1. Row level security. With RLS enabled and no policy defined, every role
--    without BYPASSRLS sees zero rows — including the table owner's ordinary
--    queries through PostgREST.
-- ---------------------------------------------------------------------------
alter table if exists public.sponsor_licences            enable row level security;
alter table if exists public.sponsor_register_imports    enable row level security;
alter table if exists public.company_sponsorship         enable row level security;
alter table if exists public.company_sponsorship_checks  enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Table privileges. Revoked from the two browser-facing roles so the tables
--    are not merely row-filtered but unreachable.
-- ---------------------------------------------------------------------------
do $$
declare
  target text;
  role_name text;
begin
  foreach target in array array[
    'public.sponsor_licences',
    'public.sponsor_register_imports',
    'public.company_sponsorship',
    'public.company_sponsorship_checks',
    'public.company_sponsorship_current'
  ] loop
    if to_regclass(target) is null then
      continue;
    end if;

    -- PUBLIC is revoked too: a privilege held by PUBLIC is held by every role,
    -- including any added later.
    execute format('revoke all on %s from public', target);

    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke all on %s from %I', target, role_name);
      end if;
    end loop;

    -- The backend reads and writes these tables with the service role key.
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on %s to service_role', target);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. The view must not become a way around the tables it reads.
--
--    A view created without `security_invoker` runs with its OWNER's rights, so
--    it would return rows from tables the caller is not allowed to read —
--    exactly the hole RLS was enabled to close. `security_invoker = true` makes
--    it run as the caller, so the policies above apply through it.
--
--    Requires PostgreSQL 15 or newer, which every current Supabase project is.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.company_sponsorship_current') is not null then
    execute 'alter view public.company_sponsorship_current '
            'set (security_invoker = true)';
  end if;
end
$$;

comment on table public.sponsor_licences is
  'GOV.UK sponsor register. RLS-denied to anon and authenticated: reachable '
  'only via the backend service role, which applies entitlement checks.';
