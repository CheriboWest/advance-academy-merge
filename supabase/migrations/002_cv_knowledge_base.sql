-- ============================================================================
--  ADVANCE INTERVIEW LAB — CV Knowledge Base
--  Idempotent: safe to re-run.
-- ============================================================================

-- ── 17. CV Versions ─────────────────────────────────────────────────────────
create table if not exists cv_versions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  name             text not null,
  source_file_path text,
  raw_text         text not null,
  detected_field   text,
  is_active        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_cv_versions_user
  on cv_versions(user_id);

create unique index if not exists idx_cv_versions_one_active_per_user
  on cv_versions(user_id) where is_active = true;

-- ── 18. CV Bullets ──────────────────────────────────────────────────────────
create table if not exists cv_bullets (
  id            uuid primary key default gen_random_uuid(),
  cv_version_id uuid not null references cv_versions(id) on delete cascade,
  section_path  text,
  bullet_text   text not null,
  ordinal       int not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_cv_bullets_version
  on cv_bullets(cv_version_id);

-- ── 19. Bullet Gaps ─────────────────────────────────────────────────────────
create table if not exists bullet_gaps (
  id         uuid primary key default gen_random_uuid(),
  bullet_id  uuid not null references cv_bullets(id) on delete cascade,
  question   text not null,
  rationale  text,
  ordinal    int not null,
  status     text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bullet_gaps_bullet
  on bullet_gaps(bullet_id);

create unique index if not exists idx_bullet_gaps_unique_ordinal
  on bullet_gaps(bullet_id, ordinal);

-- ── 20. Bullet Artifacts ────────────────────────────────────────────────────
create table if not exists bullet_artifacts (
  id               uuid primary key default gen_random_uuid(),
  gap_id           uuid not null references bullet_gaps(id) on delete cascade,
  source_type      text not null,
  content_text     text,
  source_url       text,
  source_file_path text,
  summary_json     jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists idx_bullet_artifacts_gap
  on bullet_artifacts(gap_id);

-- ── 21. interview_sessions.cv_version_id ────────────────────────────────────
alter table interview_sessions
  add column if not exists cv_version_id uuid references cv_versions(id) on delete set null;

create index if not exists idx_sessions_cv_version
  on interview_sessions(cv_version_id);
