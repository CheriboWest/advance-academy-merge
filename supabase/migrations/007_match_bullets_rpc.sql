-- ============================================================================
--  ADVANCE INTERVIEW LAB — match_bullets RPC + HNSW index
--  Used by the embedding-based retrieval in coach-answer (preview phase).
--  Idempotent: safe to re-run.
-- ============================================================================

-- HNSW index on bullet_embedding for fast cosine-similarity lookups.
-- Cosine ops give us cosine distance via the <=> operator (lower = more similar).
-- HNSW outperforms IVFFlat at this scale (<10k bullets per user) without a
-- training step, and it doesn't degrade as bullets are inserted/updated.
create index if not exists idx_cv_bullets_embedding_hnsw
  on cv_bullets
  using hnsw (bullet_embedding vector_cosine_ops);

-- Drop any prior signature so re-runs replace cleanly.
drop function if exists match_bullets(vector, uuid, integer);
drop function if exists match_bullets(vector, uuid, double precision, integer);
drop function if exists match_bullets(vector, uuid, float, integer);

-- match_bullets: top-K user bullets above a cosine-similarity threshold.
-- - similarity = 1 - cosine_distance (so 1.0 is identical, 0.0 is orthogonal)
-- - match_threshold filters out clearly-unrelated bullets before LIMIT applies
-- - returns gap counts so the UI can display "X/Y gaps filled" without an extra query
create function match_bullets(
  query_embedding   vector(1024),
  match_user_id     uuid,
  match_threshold   float,
  match_count       integer
) returns table (
  id                 uuid,
  bullet_text        text,
  section_path       text,
  similarity         float,
  gap_count          integer,
  answered_gap_count integer
)
language sql stable as $$
  select
    b.id,
    b.bullet_text,
    b.section_path,
    1 - (b.bullet_embedding <=> query_embedding) as similarity,
    coalesce(g.total, 0)::int as gap_count,
    coalesce(g.answered, 0)::int as answered_gap_count
  from cv_bullets b
  left join lateral (
    select
      count(*)::int as total,
      count(*) filter (where status = 'answered')::int as answered
    from bullet_gaps
    where bullet_id = b.id
  ) g on true
  where b.user_id = match_user_id
    and b.bullet_embedding is not null
    and 1 - (b.bullet_embedding <=> query_embedding) >= match_threshold
  order by b.bullet_embedding <=> query_embedding asc
  limit match_count;
$$;
