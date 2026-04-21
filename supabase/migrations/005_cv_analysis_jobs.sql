-- ============================================================================
--  ADVANCE INTERVIEW LAB — CV Optimizer Analysis Jobs
--  Replaces in-memory job Map so jobs survive across backend instances.
--  Idempotent: safe to re-run.
-- ============================================================================

create table if not exists cv_analysis_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  status        text not null check (status in ('queued','running','completed','failed')),
  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  result_json   jsonb,
  error_json    jsonb
);

create index if not exists idx_cv_analysis_jobs_user
  on cv_analysis_jobs(user_id);

create index if not exists idx_cv_analysis_jobs_updated_at
  on cv_analysis_jobs(updated_at desc);
