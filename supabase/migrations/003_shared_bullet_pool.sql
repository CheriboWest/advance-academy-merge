-- ============================================================================
--  ADVANCE INTERVIEW LAB — Shared Bullet Pool + pgvector
--  Idempotent: safe to re-run.
-- ============================================================================

-- Enable pgvector
create extension if not exists vector;

-- ── 1. Add user_id + embedding to cv_bullets ────────────────────────────────
alter table cv_bullets
  add column if not exists user_id uuid references users(id) on delete cascade;

alter table cv_bullets
  add column if not exists bullet_embedding vector(1024);

-- Backfill user_id from cv_versions for existing rows
update cv_bullets
set user_id = cv.user_id
from cv_versions cv
where cv_bullets.cv_version_id = cv.id
  and cv_bullets.user_id is null;

-- Make user_id NOT NULL after backfill
-- (safe: all existing rows now have user_id from the update above)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'cv_bullets' and column_name = 'user_id' and is_nullable = 'YES'
  ) then
    -- Only set NOT NULL if there are no null rows left
    if not exists (select 1 from cv_bullets where user_id is null) then
      alter table cv_bullets alter column user_id set not null;
    end if;
  end if;
end $$;

create index if not exists idx_cv_bullets_user on cv_bullets(user_id);

-- ── 2. Junction table: which bullets appear in which CV versions ────────────
create table if not exists cv_version_bullets (
  id            uuid primary key default gen_random_uuid(),
  cv_version_id uuid not null references cv_versions(id) on delete cascade,
  bullet_id     uuid not null references cv_bullets(id) on delete cascade,
  ordinal       int not null,
  section_path  text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_cvb_version on cv_version_bullets(cv_version_id);
create index if not exists idx_cvb_bullet on cv_version_bullets(bullet_id);
create unique index if not exists idx_cvb_unique on cv_version_bullets(cv_version_id, bullet_id);

-- Backfill junction rows from existing cv_bullets
insert into cv_version_bullets (cv_version_id, bullet_id, ordinal, section_path)
select cv_version_id, id, ordinal, section_path
from cv_bullets
where cv_version_id is not null
on conflict do nothing;

-- ── 3. Make cv_bullets.cv_version_id nullable ───────────────────────────────
alter table cv_bullets alter column cv_version_id drop not null;
