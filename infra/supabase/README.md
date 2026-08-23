# Supabase (`infra/supabase`)

Supabase project configuration and migrations for CareerHub UK.

The **source of truth is the Supabase project itself** — it was created before
these files existed, so `schema.sql` is a human-readable *mirror* of the
expected shape, not a script that produced it. Treat any difference between the
two as the live database being right and the mirror being stale.

## Layout

```
infra/supabase/
├── schema.sql        # mirror of the expected schema (reference only)
├── migrations/       # applied in filename order
└── tests/            # SQL self-checks, run against a throwaway database
```

## Migrations

| File | Purpose |
| ---- | ------- |
| `0001_crawler_ingestion.sql` | Crawler/dedup columns, `discovery_queries`, `crawl_runs`, `public_company_summary` |
| `0002_crawl_run_stats.sql` | Additional `crawl_runs` statistics columns |
| `0003_job_title_search.sql` | `pg_trgm` + GIN index backing Job Role Search |
| `0004_company_permanent_delete.sql` | `delete_companies_permanently(uuid[])` — transactional, `service_role`-only permanent company deletion |
| `0006_sponsor_register.sql` | `sponsor_licences`, `sponsor_register_imports`, `company_sponsorship` + the `company_sponsorship_current` view |

All migrations are additive and idempotent: re-running one is a no-op.

Apply them in the Supabase SQL editor (or `psql`) in filename order.

## Permanent company deletion (0004)

`companies` is referenced by `jobs` and `coach_company_meta` with
`ON DELETE NO ACTION`, so a bare `delete from companies` fails on a foreign key.
Migration 0004 adds a `SECURITY DEFINER` function that removes the dependants
and the company in **one transaction**:

- `jobs` — deleted (shared crawler data).
- `coach_company_meta` — deleted, for every coach (per-coach stars/notes/hidden
  for that company; the foreign key also forbids leaving it behind).
- `outreach_emails` — **kept**, with `company_id` set to `null`. Drafts and
  sent-mail records are coach-authored content, not the company's data.
- `companies` — deleted.

If any *other* table references `companies.id`, the function raises and rolls
back, naming the table. Extend it explicitly rather than letting deletion depend
on cascade behaviour nobody audited.

Execute is granted to `service_role` only, so the destructive path is reachable
only through `POST /companies/delete` on `apps/api`, which verifies the coach's
JWT first. `anon` and `authenticated` (a coach's browser session) cannot call
it.

## Running the SQL self-checks

Against a throwaway local PostgreSQL database (never the live project):

```bash
createdb ch_test
psql -v ON_ERROR_STOP=1 -d ch_test -f infra/supabase/schema.sql
psql -v ON_ERROR_STOP=1 -d ch_test -f infra/supabase/migrations/0004_company_permanent_delete.sql
psql -v ON_ERROR_STOP=1 -d ch_test -f infra/supabase/tests/0004_company_permanent_delete_test.sql
```

Assertions use `raise exception`, so `ON_ERROR_STOP=1` is required — the run
aborts on the first failure and prints `PASS`/`FAIL` per check. The role-grant
checks are skipped unless `anon`, `authenticated`, and `service_role` exist
locally; create them as bare `nologin` roles to exercise those too.
