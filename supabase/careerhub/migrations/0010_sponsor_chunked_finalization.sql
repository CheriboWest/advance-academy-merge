-- CareerHub UK — publish a staged sponsor-register edition in bounded chunks
--
-- Additive and idempotent. Adds one column, one partial index and four
-- functions. No existing table, column, index or row is dropped or rewritten
-- by this migration, and finalize_sponsor_register_import() from 0009 is left
-- in place (unused by the importer after this ships, kept for reference and so
-- nothing that already calls it directly breaks).
--
-- Why
-- ---
-- 0009 made a partial import harmless, but publishing a COMPLETE one still ran
-- as a single UPDATE over every staged row. Against the real 141,904-row
-- edition that statement took ~8.5s locally and was cancelled server-side with
-- Postgres error 57014 ("canceling statement due to statement timeout") on
-- every attempt — three times, with the same result each time. Raising the
-- timeout was ruled out on purpose: it treats the symptom, and the next
-- edition, larger than this one, would hit the same wall again.
--
-- EXPLAIN ANALYZE against a representative local dataset (138,000 existing
-- rows + 141,904 staged, matching the reported production shape) showed
-- exactly where the time went: the single promotion UPDATE touched over four
-- million buffers, not because reading 141,904 rows is expensive, but because
-- every one of them needed maintaining across six indexes (five B-trees plus a
-- GIN trigram index) and an FK-constraint check, all inside one uninterruptible
-- statement:
--
--     Update on sponsor_licences (actual time=5013.438..5013.439 rows=0)
--       Buffers: shared hit=4045623 dirtied=4380 written=4689
--       Trigger for constraint sponsor_licences_last_import_id_fkey: time=520.629
--       Execution Time: 5544.115 ms
--
-- The withdrawal UPDATE and the final count were both fast in the same test
-- (~20ms) — the bottleneck is specifically the promotion of a full six-figure
-- edition in one go.
--
-- The fix is not a faster query. It is the same statement run many times over
-- a bounded slice of rows, so no single call can ever approach the timeout
-- regardless of how large a future edition gets.

-- ---------------------------------------------------------------------------
-- 1. A column for cumulative, idempotent withdrawal accounting.
--
-- `withdrawn_at` already says WHEN a row left the register; this says which
-- import's finalization made that call. Recording it is what lets
-- complete_sponsor_register_import() report an accurate rows_withdrawn total
-- from durable state after however many chunk calls it took, including ones a
-- client retried after a timeout — counting rows beats accumulating a number
-- across possibly-lost HTTP responses.
-- ---------------------------------------------------------------------------
alter table public.sponsor_licences
  add column if not exists withdrawn_by_import_id uuid
    references public.sponsor_register_imports (id) on delete set null;

comment on column public.sponsor_licences.withdrawn_by_import_id is
  'The import whose finalization withdrew this row. Set once, alongside '
  'withdrawn_at; re-withdrawing an already-withdrawn row on retry does not '
  'change it, which is what keeps rows_withdrawn accurate under retries.';

create index if not exists sponsor_licences_withdrawn_by_import_idx
  on public.sponsor_licences (withdrawn_by_import_id);

-- ---------------------------------------------------------------------------
-- 2. The index a chunk-selection query actually needs.
--
-- staged_import_id already has a plain B-tree index (0009), which is enough to
-- find ONE import's staged rows but not enough to find efficiently which of
-- them still need promoting: that needs `last_import_id IS DISTINCT FROM
-- staged_import_id` to be indexed too, or every "give me the next chunk" call
-- degrades toward a sequential scan as the easy answers run out.
--
-- The predicate compares two columns of the same row rather than a column to a
-- parameter, which is what makes ONE static index correct for every import,
-- present and future: a row satisfies it exactly while it is staged but not
-- yet published, so the index shrinks on its own as promotion proceeds and a
-- chunk call never has to look past rows that are already done.
--
-- Verified locally: with this index, selecting the next 2,000 rows to promote
-- out of 141,904 costs 51 buffer hits and well under a millisecond, and stays
-- that way however many rows have already been promoted — the seq-scan
-- alternative measured in the thousands of buffer hits and tens of
-- milliseconds even in a favourable physical layout, and has no such guarantee
-- in general.
-- ---------------------------------------------------------------------------
create index concurrently if not exists sponsor_licences_needs_promotion_idx
  on public.sponsor_licences (staged_import_id)
  where last_import_id is distinct from staged_import_id;

comment on index public.sponsor_licences_needs_promotion_idx is
  'Rows staged but not yet published by their staging import. Self-shrinking: '
  'a row drops out the moment promote_sponsor_register_import_chunk() runs it. '
  'Backs the chunk-selection query in that function.';

-- Withdrawal chunk selection reuses the existing partial index on (is_current)
-- from 0006 rather than adding another: it already returns only the current
-- set, which is the same "shrinks as work completes" property, and measured
-- fast (~20ms) even scanning the whole current set in one pass. A second index
-- keyed on is_current would duplicate it for no measured benefit.

-- ---------------------------------------------------------------------------
-- 3. Status semantics
--
-- No CHECK constraint has ever enforced status's values (0006 introduced it as
-- plain text, comment-documented as running | success | error), so adding one
-- more is a documentation change, not a schema change, and every existing row
-- and API consumer stays valid.
--
--   running     the importer is still parsing/staging rows.
--   finalizing  every row is staged; publication is under way in chunks.
--               Set only by begin_sponsor_register_finalization(), which is
--               also what lets an eligible `error` run resume: staging can
--               fail forward into 'error', but finalization failing partway
--               leaves the run in 'finalizing' rather than 'error' so a
--               resumed run picks up in the right phase and the two kinds of
--               failure ("staging never finished" vs "staging finished, only
--               publication failed") are never confused with each other.
--   success     finalization completed: every staged row is either current or
--               (if superseded) withdrawn, and the counts are final.
--   error       staging failed outright, OR finalization failed and was never
--               resumed to a conclusion.
-- ---------------------------------------------------------------------------
comment on column public.sponsor_register_imports.status is
  'running | finalizing | success | error. See migration 0010 for the full '
  'state machine — finalizing is new there and is what makes a run that '
  'finished staging but failed to publish resumable without re-staging.';

-- ---------------------------------------------------------------------------
-- 4. begin_sponsor_register_finalization — enter (or resume) publication.
--
-- The only place status becomes 'finalizing'. Refuses an import that staged
-- nothing (same guard 0009 had) and refuses one already published, so calling
-- it twice — including on a run this exact function already moved to
-- 'finalizing' — is a safe no-op that reports where the run stands rather than
-- restarting it or raising.
-- ---------------------------------------------------------------------------
create or replace function public.begin_sponsor_register_finalization(
  p_import_id uuid
)
returns table (
  staged_rows integer,
  status      text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_staged bigint;
begin
  select s.status into v_status
    from public.sponsor_register_imports s
   where s.id = p_import_id
     for update;

  if not found then
    raise exception
      'begin_sponsor_register_finalization: import % does not exist', p_import_id
      using errcode = 'no_data_found';
  end if;

  if v_status = 'success' then
    -- Idempotent: a retried call after the previous one actually succeeded
    -- must not look like a failure to the caller.
    select count(*) into v_staged
      from public.sponsor_licences where staged_import_id = p_import_id;
    return query select v_staged::integer, 'success'::text;
    return;
  end if;

  if v_status not in ('running', 'error', 'finalizing') then
    raise exception
      'begin_sponsor_register_finalization: import % has unrecognised status %',
      p_import_id, v_status
      using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_staged
    from public.sponsor_licences where staged_import_id = p_import_id;

  if v_staged = 0 then
    raise exception
      'begin_sponsor_register_finalization: import % staged no rows; there is '
      'nothing to publish', p_import_id
      using errcode = 'invalid_parameter_value';
  end if;

  update public.sponsor_register_imports
     set status = 'finalizing',
         error  = null
   where id = p_import_id;

  return query select v_staged::integer, 'finalizing'::text;
end;
$$;

comment on function public.begin_sponsor_register_finalization(uuid) is
  'Enters (or resumes) publication of a staged edition. The only place status '
  'becomes finalizing. Idempotent: safe to call again mid-run or after success.';

-- ---------------------------------------------------------------------------
-- 5. promote_sponsor_register_import_chunk — publish up to p_limit rows.
--
-- Bounded by construction: the UPDATE's own source is a LIMIT p_limit
-- subquery, so no single call can ever touch more rows than the caller asked
-- for, however large the edition. Idempotent for the same reason 0009's single
-- UPDATE was: the WHERE clause selects rows that still need promoting, so a
-- chunk that committed before its client saw the response is simply absent
-- from the next call's selection — there is no "did that commit?" branch to
-- get wrong.
-- ---------------------------------------------------------------------------
create or replace function public.promote_sponsor_register_import_chunk(
  p_import_id uuid,
  p_limit     integer default 2000
)
returns table (
  processed integer,
  remaining integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status    text;
  v_processed integer;
  v_remaining bigint;
begin
  if p_limit is null or p_limit < 1 then
    raise exception
      'promote_sponsor_register_import_chunk: p_limit must be a positive '
      'integer, got %', p_limit
      using errcode = 'invalid_parameter_value';
  end if;

  select s.status into v_status
    from public.sponsor_register_imports s where s.id = p_import_id;

  if not found then
    raise exception
      'promote_sponsor_register_import_chunk: import % does not exist',
      p_import_id
      using errcode = 'no_data_found';
  end if;

  if v_status = 'success' then
    -- A retried call after the edition already finished publishing. Nothing
    -- can be outstanding; report that rather than raising.
    return query select 0, 0;
    return;
  end if;

  if v_status != 'finalizing' then
    raise exception
      'promote_sponsor_register_import_chunk: import % is not finalizing '
      '(status=%); call begin_sponsor_register_finalization() first',
      p_import_id, v_status
      using errcode = 'invalid_parameter_value';
  end if;

  with chunk as (
    select id from public.sponsor_licences
     where staged_import_id = p_import_id
       and last_import_id is distinct from staged_import_id
     limit p_limit
  )
  update public.sponsor_licences sl
     set is_current     = true,
         withdrawn_at   = null,
         last_seen_at   = now(),
         last_import_id = p_import_id,
         updated_at     = now()
    from chunk
   where sl.id = chunk.id;
  get diagnostics v_processed = row_count;

  select count(*) into v_remaining
    from public.sponsor_licences
   where staged_import_id = p_import_id
     and last_import_id is distinct from staged_import_id;

  return query select v_processed, v_remaining::integer;
end;
$$;

comment on function public.promote_sponsor_register_import_chunk(uuid, integer) is
  'Promotes up to p_limit still-unpromoted rows of a staged, finalizing '
  'import. Call repeatedly until remaining=0. Idempotent: an already-promoted '
  'row is never selected again.';

-- ---------------------------------------------------------------------------
-- 6. withdraw_sponsor_register_chunk — withdraw up to p_limit stale rows.
--
-- Only runs once promotion has finished (checked below), matching the order
-- 0009 always used: an edition is fully staged as current before anything is
-- retired, so a partial promotion can never be read as "this licence is gone".
-- Bounded and idempotent for the same reasons as the promotion chunk.
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_sponsor_register_chunk(
  p_import_id uuid,
  p_limit     integer default 2000
)
returns table (
  processed integer,
  remaining integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status         text;
  v_still_promoting bigint;
  v_processed      integer;
  v_remaining      bigint;
begin
  if p_limit is null or p_limit < 1 then
    raise exception
      'withdraw_sponsor_register_chunk: p_limit must be a positive integer, '
      'got %', p_limit
      using errcode = 'invalid_parameter_value';
  end if;

  select s.status into v_status
    from public.sponsor_register_imports s where s.id = p_import_id;

  if not found then
    raise exception
      'withdraw_sponsor_register_chunk: import % does not exist', p_import_id
      using errcode = 'no_data_found';
  end if;

  if v_status = 'success' then
    return query select 0, 0;
    return;
  end if;

  if v_status != 'finalizing' then
    raise exception
      'withdraw_sponsor_register_chunk: import % is not finalizing (status=%); '
      'call begin_sponsor_register_finalization() first', p_import_id, v_status
      using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_still_promoting
    from public.sponsor_licences
   where staged_import_id = p_import_id
     and last_import_id is distinct from staged_import_id;

  if v_still_promoting > 0 then
    raise exception
      'withdraw_sponsor_register_chunk: import % still has % row(s) unpromoted; '
      'finish promote_sponsor_register_import_chunk() first', p_import_id,
      v_still_promoting
      using errcode = 'invalid_parameter_value';
  end if;

  with chunk as (
    select id from public.sponsor_licences
     where is_current = true
       and staged_import_id is distinct from p_import_id
     limit p_limit
  )
  update public.sponsor_licences sl
     set is_current             = false,
         withdrawn_at           = now(),
         withdrawn_by_import_id = p_import_id,
         updated_at             = now()
    from chunk
   where sl.id = chunk.id;
  get diagnostics v_processed = row_count;

  select count(*) into v_remaining
    from public.sponsor_licences
   where is_current = true
     and staged_import_id is distinct from p_import_id;

  return query select v_processed, v_remaining::integer;
end;
$$;

comment on function public.withdraw_sponsor_register_chunk(uuid, integer) is
  'Withdraws up to p_limit live rows this import did not stage. Refuses to run '
  'until promotion is complete. Call repeatedly until remaining=0. Idempotent.';

-- ---------------------------------------------------------------------------
-- 7. complete_sponsor_register_import — verify and publish.
--
-- The only place status becomes 'success'. Re-derives every number from
-- current table state rather than trusting anything accumulated across the
-- chunk calls that got here, and refuses to publish unless both phases are
-- verifiably finished AND the current set is exactly this edition's rows —
-- the same "no obsolete current rows remain" check the brief asked for.
-- ---------------------------------------------------------------------------
create or replace function public.complete_sponsor_register_import(
  p_import_id uuid
)
returns table (
  rows_processed     integer,
  rows_current_after integer,
  rows_withdrawn     integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status         text;
  v_unpromoted     bigint;
  v_stale_current  bigint;
  v_promoted       bigint;
  v_current        bigint;
  v_withdrawn      bigint;
begin
  select s.status, s.rows_current_after, s.rows_withdrawn, s.rows_processed
    into v_status, v_current, v_withdrawn, v_promoted
    from public.sponsor_register_imports s
   where s.id = p_import_id
     for update;

  if not found then
    raise exception
      'complete_sponsor_register_import: import % does not exist', p_import_id
      using errcode = 'no_data_found';
  end if;

  if v_status = 'success' then
    -- Idempotent: the previous call published this edition; a retry after a
    -- lost response reports the same, already-durable numbers rather than
    -- re-verifying (and possibly raising on) a table that has moved on since.
    return query select
      coalesce(v_promoted, 0)::integer,
      coalesce(v_current, 0)::integer,
      coalesce(v_withdrawn, 0)::integer;
    return;
  end if;

  if v_status != 'finalizing' then
    raise exception
      'complete_sponsor_register_import: import % is not finalizing (status=%)',
      p_import_id, v_status
      using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_unpromoted
    from public.sponsor_licences
   where staged_import_id = p_import_id
     and last_import_id is distinct from staged_import_id;
  if v_unpromoted > 0 then
    raise exception
      'complete_sponsor_register_import: % staged row(s) are still '
      'unpromoted; call promote_sponsor_register_import_chunk() until it '
      'reports remaining=0', v_unpromoted
      using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_stale_current
    from public.sponsor_licences
   where is_current = true
     and staged_import_id is distinct from p_import_id;
  if v_stale_current > 0 then
    raise exception
      'complete_sponsor_register_import: % live row(s) do not belong to this '
      'edition; call withdraw_sponsor_register_chunk() until it reports '
      'remaining=0', v_stale_current
      using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_promoted
    from public.sponsor_licences
   where staged_import_id = p_import_id and last_import_id = p_import_id;

  select count(*) into v_current
    from public.sponsor_licences where is_current;

  -- Now that withdrawal is confirmed complete (checked above), the live set
  -- can only be this edition's promoted rows — anything else would mean a row
  -- became current by some path other than this import's own promotion, which
  -- must never happen and is worth failing loudly over rather than publishing.
  if v_current != v_promoted then
    raise exception
      'complete_sponsor_register_import: % row(s) are current but not '
      'credited to import % (current=%, promoted=%) — refusing to publish; '
      'this indicates a concurrent write outside this finalization',
      v_current - v_promoted, p_import_id, v_current, v_promoted
      using errcode = 'data_exception';
  end if;

  select count(*) into v_withdrawn
    from public.sponsor_licences where withdrawn_by_import_id = p_import_id;

  update public.sponsor_register_imports
     set status             = 'success',
         rows_processed     = v_promoted,
         rows_current_after = v_current,
         rows_withdrawn     = v_withdrawn,
         finished_at        = now(),
         error              = null
   where id = p_import_id;

  return query select v_promoted::integer, v_current::integer, v_withdrawn::integer;
end;
$$;

comment on function public.complete_sponsor_register_import(uuid) is
  'Verifies both phases finished and every current row belongs to this '
  'edition, then marks the import success with counts re-derived from the '
  'table. The only place status becomes success. Idempotent.';

-- ---------------------------------------------------------------------------
-- 8. Execution rights — service_role only, same posture as 0009.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
  role_name text;
begin
  foreach fn in array array[
    'public.begin_sponsor_register_finalization(uuid)',
    'public.promote_sponsor_register_import_chunk(uuid, integer)',
    'public.withdraw_sponsor_register_chunk(uuid, integer)',
    'public.complete_sponsor_register_import(uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke all on function %s from %I', fn, role_name);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$$;
