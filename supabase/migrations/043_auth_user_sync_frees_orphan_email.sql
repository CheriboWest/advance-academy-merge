-- Let a deleted account's email be reused.
--
-- `public.users` has no foreign key to `auth.users`, so deleting someone in the
-- Authentication dashboard leaves their `public.users` row behind. Recreating an
-- account with that same email then fails: `006`'s trigger resolves conflicts on
-- `id`, but `email` is the column that is `unique`, and the new account has a
-- fresh uuid. The insert raises, the trigger aborts, and Supabase cannot create
-- the user at all. Hit for real on 2026-09-24 recreating coach1@example.com.
--
-- This renames the stranded row instead of deleting it, which matters twice:
--
--   * Deleting would take the old account's data with it — fifteen tables
--     cascade off `public.users(id)`.
--   * Deleting can itself fail. `admin_actions.actor_id` (016:16) is NOT NULL
--     with no ON DELETE action, so an orphan that ever performed an admin action
--     blocks its own removal — and the trigger would abort exactly as before,
--     having achieved nothing.
--
-- Renaming frees the unique constraint, touches no other row, keeps the audit
-- trail intact, and leaves the old row visible for anyone who wants to look.
--
-- The `not exists` guard is what makes this safe: only a row whose id has no
-- matching `auth.users` record is touched, so a live account can never be
-- renamed out from under itself.
--
-- Considered and rejected: adding `public.users.id references auth.users(id)
-- on delete cascade`. Three foreign keys — `users.referred_by` (014:19),
-- `users.reviewed_by` (018:27), `admin_actions.actor_id` (016:16) — declare no
-- ON DELETE action, so they reject a cascade rather than follow it. Anyone who
-- had invited someone, reviewed an account, or acted as an admin would become
-- undeletable. Making the cascade work means setting those three to SET NULL,
-- which erases who performed each past admin action from the only audit table
-- this system has.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.users u
     set email = u.email || '.orphaned.' || to_char(now(), 'YYYYMMDDHH24MISS')
   where u.email = new.email
     and u.id <> new.id
     and not exists (select 1 from auth.users a where a.id = u.id);

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

comment on function public.handle_new_auth_user() is
  'Copies a new auth user into public.users, first renaming any orphaned row '
  'holding the same email so the unique constraint does not block sign-up — '
  'see migration 043.';
