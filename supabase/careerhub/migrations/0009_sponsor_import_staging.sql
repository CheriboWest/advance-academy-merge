-- CareerHub UK — stage-then-promote sponsor-register imports
--
-- Additive and idempotent. Adds three columns, two indexes and one function.
-- No existing row is deleted, and no existing value is rewritten.
--
-- Why
-- ---
-- The importer used to decide what to withdraw in Python: it paged the whole of
-- `sponsor_licences` over PostgREST, built a set of every stored natural key,
-- and withdrew the keys the new file did not contain. At 138,000 rows that
-- prefetch is 138 sequential requests before the first row is written, and the
-- real import died on page 5. The work is a single UPDATE in the database and
-- has no business being a download.
--
-- It also made a *partial* import dangerous in a subtler way. Every batch wrote
-- `is_current = true, withdrawn_at = null`, so a run that failed halfway had
-- already reactivated any row in its first half that a previous edition had
-- withdrawn — the register would claim licences were live on the authority of
-- an import that never finished.
--
-- Both problems have the same fix: writing a row and publishing it become two
-- different acts.
--
--   staged_import_id   set by every batch upsert. Means "this run wrote this
--                      row". Carries no authority whatsoever.
--   last_import_id     set only by finalization. Means "this row belongs to
--                      that SUCCESSFUL edition".
--   is_current         changed only by finalization.
--
-- A failed import therefore leaves rows in the table carrying its marker, and
-- that is harmless by construction: nothing reads `staged_import_id`, the rows
-- it inserted default to `is_current = false`, and the rows it updated keep
-- whatever currency the last successful edition gave them. The previous edition
-- stays authoritative until a new one finishes in full.

-- What staging relies on
-- ----------------------
-- Batch writes omit `is_current`, `withdrawn_at` and `last_seen_at` from the
-- payload. PostgREST builds one INSERT ... ON CONFLICT DO UPDATE from the keys
-- present in the request body, so an omitted column takes the table default on
-- insert and is left untouched on conflict — which is what keeps a staging
-- write from deciding currency.
--
-- If that ever stopped holding, a staged row would come back not-current with
-- no `withdrawn_at`: a state nothing in the importer produces deliberately.
-- Query 3d in verify_sponsor_import.sql counts them. The failure direction is
-- the safe one (a licence goes missing rather than being invented) and the next
-- successful import repairs it, but it should always be zero.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.sponsor_licences
  add column if not exists staged_import_id uuid
    references public.sponsor_register_imports (id) on delete set null;

alter table public.sponsor_licences
  add column if not exists staged_seen_at timestamptz;

alter table public.sponsor_licences
  add column if not exists last_import_id uuid
    references public.sponsor_register_imports (id) on delete set null;

comment on column public.sponsor_licences.staged_import_id is
  'The import run that last wrote this row. NOT a statement that the row is '
  'live: a failed run leaves its id here on rows it never got to publish.';
comment on column public.sponsor_licences.staged_seen_at is
  'When the row was last written by any import run, successful or not.';
comment on column public.sponsor_licences.last_import_id is
  'The last SUCCESSFUL edition this row appeared in. Written only by '
  'finalize_sponsor_register_import().';

-- A new row must not be live until an import finishes. Existing rows are
-- untouched — a default applies to future inserts only, which is exactly the
-- scope wanted here.
alter table public.sponsor_licences
  alter column is_current set default false;

comment on column public.sponsor_licences.last_seen_at is
  'When this row was last part of a SUCCESSFUL edition. Set by finalization, '
  'not by the batch that wrote the row.';

-- ---------------------------------------------------------------------------
-- 2. Indexes for the two statements finalization runs
-- ---------------------------------------------------------------------------
create index if not exists sponsor_licences_staged_import_idx
  on public.sponsor_licences (staged_import_id);
create index if not exists sponsor_licences_last_import_idx
  on public.sponsor_licences (last_import_id);

-- ---------------------------------------------------------------------------
-- 3. Statistics columns
--
-- `rows_inserted` / `rows_updated` / `rows_unchanged` were only ever computable
-- because Python held the whole table in memory. They are not worth a full-table
-- scan, and reporting 0 for an import that wrote 141,904 rows would be a lie, so
-- they become nullable and are left NULL by imports from this migration onward.
-- The replacements are counted by the database as a side effect of work it is
-- already doing.
-- ---------------------------------------------------------------------------
alter table public.sponsor_register_imports
  alter column rows_inserted  drop not null,
  alter column rows_updated   drop not null,
  alter column rows_unchanged drop not null;

alter table public.sponsor_register_imports
  add column if not exists rows_processed integer;
alter table public.sponsor_register_imports
  add column if not exists rows_current_after integer;

comment on column public.sponsor_register_imports.rows_inserted is
  'DEPRECATED since migration 0009; NULL for sponsor imports. Distinguishing '
  'insert from update required downloading the whole table. Use rows_processed.';
comment on column public.sponsor_register_imports.rows_updated is
  'DEPRECATED since migration 0009; NULL for sponsor imports.';
comment on column public.sponsor_register_imports.rows_unchanged is
  'DEPRECATED since migration 0009; NULL for sponsor imports.';
comment on column public.sponsor_register_imports.rows_processed is
  'Rows this edition staged and finalization promoted to current.';
comment on column public.sponsor_register_imports.rows_current_after is
  'Rows left current across the whole table once this import finalized.';

-- ---------------------------------------------------------------------------
-- 4. Finalization
--
-- The only place `is_current` changes. Called once, after every batch upsert has
-- been confirmed; an import that fails never reaches it, which is what keeps a
-- partial edition non-authoritative.
--
-- Idempotent: calling it twice for the same import promotes the same rows and
-- finds nothing left to withdraw.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_sponsor_register_import(
  p_import_id uuid
)
returns table (
  rows_promoted  bigint,
  rows_withdrawn bigint,
  rows_current   bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status    text;
  v_staged    bigint;
  v_promoted  bigint;
  v_withdrawn bigint;
  v_current   bigint;
begin
  -- The row is locked for the duration: two finalizations racing could withdraw
  -- each other's edition.
  select status into v_status
    from public.sponsor_register_imports
   where id = p_import_id
     for update;

  if not found then
    raise exception
      'finalize_sponsor_register_import: import % does not exist', p_import_id
      using errcode = 'no_data_found';
  end if;

  if v_status = 'error' then
    raise exception
      'finalize_sponsor_register_import: import % is already recorded as failed '
      'and must not publish an edition', p_import_id
      using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_staged
    from public.sponsor_licences
   where staged_import_id = p_import_id;

  -- An import that staged nothing is not an empty register — it is a broken
  -- run. Withdrawing on its authority would retire every licence we hold.
  if v_staged = 0 then
    raise exception
      'finalize_sponsor_register_import: import % staged no rows; refusing to '
      'withdraw the register', p_import_id
      using errcode = 'invalid_parameter_value';
  end if;

  -- Promote first, so the withdrawal below cannot see this edition's own rows.
  update public.sponsor_licences
     set is_current     = true,
         withdrawn_at   = null,
         last_seen_at   = now(),
         last_import_id = p_import_id,
         updated_at     = now()
   where staged_import_id = p_import_id;
  get diagnostics v_promoted = row_count;

  -- Everything still live that this edition did not carry. Rows are never
  -- deleted: absence from today's register means the licence is not listed
  -- today, not that it never existed.
  update public.sponsor_licences
     set is_current   = false,
         withdrawn_at = now(),
         updated_at   = now()
   where is_current = true
     and staged_import_id is distinct from p_import_id;
  get diagnostics v_withdrawn = row_count;

  select count(*) into v_current
    from public.sponsor_licences
   where is_current;

  return query select v_promoted, v_withdrawn, v_current;
end;
$$;

comment on function public.finalize_sponsor_register_import(uuid) is
  'Publishes a staged sponsor-register edition: promotes the rows the import '
  'staged and withdraws the live rows it did not carry. The only writer of '
  'sponsor_licences.is_current. service_role only.';

-- ---------------------------------------------------------------------------
-- 5. Execution rights
--
-- SECURITY DEFINER means this runs as its owner, which bypasses the deny-all
-- RLS set up in 0008. That is the point — and it is also why the browser-facing
-- roles must not be able to call it. EXECUTE is granted to PUBLIC by default on
-- a new function, so revoking is not optional.
-- ---------------------------------------------------------------------------
revoke all on function public.finalize_sponsor_register_import(uuid) from public;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'revoke all on function public.finalize_sponsor_register_import(uuid) '
        'from %I', role_name
      );
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function '
            'public.finalize_sponsor_register_import(uuid) to service_role';
  end if;
end
$$;
