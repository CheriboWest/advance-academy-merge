-- ============================================================================
--  ADVANCE INTERVIEW LAB — Coach Understanding Reports
--  Idempotent: safe to re-run.
-- ============================================================================

create table if not exists coach_understanding_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  report_md   text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_coach_reports_user
  on coach_understanding_reports(user_id);
