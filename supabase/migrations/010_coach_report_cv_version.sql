-- Scope Coach Understanding reports to a single CV version.
-- Nullable so historical account-wide reports stay valid.
alter table coach_understanding_reports
  add column if not exists cv_version_id uuid references cv_versions(id) on delete set null;
