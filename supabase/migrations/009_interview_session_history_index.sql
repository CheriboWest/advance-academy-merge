-- Supports cursor-paginated Interview History without sorting every session
-- owned by a user on each page request.
create index if not exists idx_sessions_user_started_at
  on interview_sessions(user_id, started_at desc);
