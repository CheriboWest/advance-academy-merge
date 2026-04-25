-- ============================================================================
--  Sync auth.users → public.users on every sign-up
--  Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================================

-- Trigger function: copies the new auth user into public.users.
-- Uses the SAME uuid as auth.users so all foreign keys resolve correctly.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

-- Drop old trigger if it exists, then recreate
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- ── Back-fill: copy any existing auth users that are missing from public.users
-- (covers accounts that signed up before this trigger existed)
insert into public.users (id, email, full_name)
select
  au.id,
  au.email,
  coalesce(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1))
from auth.users au
where not exists (
  select 1 from public.users pu where pu.id = au.id
)
on conflict (id) do nothing;
