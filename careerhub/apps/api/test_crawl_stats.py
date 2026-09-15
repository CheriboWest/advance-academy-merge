"""Self-check for crawl statistics: `python test_crawl_stats.py` (no pytest).

Regression cover for two related bugs, both about what `_finalize` actually
persists to `crawl_runs`:

1. (Original bug) A finished crawl reported zeros for work it had actually
   done: the pipeline counted into `CrawlStats`, but `_finalize` wrote only
   `status` + `completed_at`, so the counts never reached `crawl_runs`.

2. (This round) `_finalize`'s single UPDATE statement bundled confirmed-live
   columns (`duplicate_jobs`, `companies_updated`) together with columns that
   migrations 0002/0005 added but were never actually applied to the live
   database (`raw_jobs`, `normalized_jobs`, `inserted_jobs`,
   `companies_created`). Postgres/PostgREST UPDATE is all-or-nothing, so that
   one statement always failed on the live table, and the fallback discarded
   *everything*, including the columns that genuinely existed — reproducing
   exactly the reported symptom (companies_created reads as a real 0, the
   other cards render blank because the fields the frontend expects were
   never in the response's prior shape at all). Fixed by writing only
   `new_jobs` / `duplicate_jobs` / `companies_discovered` / `companies_updated`
   / `jobs_found` — the columns confirmed to exist on a real completed run's
   row — and narrowing further only if even those are incomplete.

3. (This round) Worse than zeros: `_finalize` put `error` — a column the live
   table does not have, its real name being `error_message` — into the *base*
   payload, so every tier carried it, PostgREST rejected every tier, and
   `_write_crawl_run` re-raised out of an unprotected `await _finalize(...)`.
   The row never left "running" and the coach's crawler page span forever.
   Scenario 10 below is the cover: a fake whose columns are an allowlist taken
   from the live schema, rather than an opt-out list of whatever a scenario
   remembered to name — which is why scenarios 1-9 stayed green through it.

Runs offline: a fake `SupabaseRest` stands in for the database and the job
sources are stubbed, so no network and no Supabase project are involved.
"""

from __future__ import annotations

import httpx

from app.crawler.models import CrawlStats
from app.routers.discover import _row_to_status
from crawl_test_support import (
    LIVE_CRAWL_RUNS_COLUMNS,
    NOW,  # noqa: F401 - re-exported for readability of scenario data below
    PERSISTED_KEYS,
    UNPERSISTED_LEGACY_KEYS,
    FakeRest,
    check,
    crawl_run_updates,
    crawled,
    failures,
    run_crawl_with,
)

RUN_ID = "11111111-1111-1111-1111-111111111111"
OTHER_RUN_ID = "22222222-2222-2222-2222-222222222222"

# ---------------------------------------------------------------------------
# 1. A crawl that ingests real data persists non-zero statistics, under the
#    real (confirmed-live) column names.
# ---------------------------------------------------------------------------
JOBS = [
    crawled("Software Engineer", "Acme Ltd"),
    crawled("Data Analyst", "Acme Ltd"),
    crawled("Software Engineer", "Acme Ltd"),  # duplicate within the crawl
    crawled("Backend Developer", "ByteCorp"),
    crawled("Sales Manager", "ByteCorp"),
]
rest = FakeRest(companies=[{"id": "c-acme", "slug": "acme", "name": "Acme Ltd",
                            "website": None, "sector": None, "lead_score": 0}])
run_crawl_with(rest, JOBS, run_id=RUN_ID)

stored = rest.crawl_runs[RUN_ID]
check("the run reached a terminal status", stored.get("status") == "success",
      f"got {stored.get('status')!r}")
check("new_jobs persisted", stored.get("new_jobs") == 4, f"got {stored.get('new_jobs')}")
check("duplicate_jobs persisted (1 in-crawl repeat, 0 pre-existing)",
      stored.get("duplicate_jobs") == 1, f"got {stored.get('duplicate_jobs')}")
check("companies_updated persisted (Acme already existed)",
      stored.get("companies_updated") == 1, f"got {stored.get('companies_updated')}")
check("companies_discovered persisted (ByteCorp is new)",
      stored.get("companies_discovered") == 1, f"got {stored.get('companies_discovered')}")
check("jobs_found persisted (4 unique + the 1 in-crawl repeat, all verified)",
      stored.get("jobs_found") == 5, f"got {stored.get('jobs_found')}")
check("statistics are not all zero",
      any(stored.get(k) for k in PERSISTED_KEYS))

# ---------------------------------------------------------------------------
# 2. Statistics land on THAT run's row, in the SAME write as the status, so a
#    poll can never observe a terminal status alongside zeroed counts.
# ---------------------------------------------------------------------------
updates = crawl_run_updates(rest)
check("crawl_runs is written exactly once", len(updates) == 1, f"got {len(updates)}")
check("status and statistics share a single UPDATE",
      "status" in updates[0] and all(k in updates[0] for k in PERSISTED_KEYS))
check("the write is addressed to this run_id",
      all(match.get("id") == f"eq.{RUN_ID}"
          for table, match, _ in rest.updates if table == "crawl_runs"))
check("no other run row was touched", OTHER_RUN_ID not in rest.crawl_runs)
check("completed_at is set alongside the statistics", bool(updates[0].get("completed_at")))
check("the terminal write never resets a statistic to 0 after setting it",
      all(updates[0][k] == stored[k] for k in PERSISTED_KEYS))

# ---------------------------------------------------------------------------
# 8. Regression: _finalize never attempts the migration-0002/0005 columns
#    that are not actually on the live table — bundling them with real
#    columns in one statement is exactly what caused every statistic to be
#    discarded before this fix.
# ---------------------------------------------------------------------------
check("the write never includes the un-persisted legacy columns",
      not any(k in updates[0] for k in UNPERSISTED_LEGACY_KEYS),
      f"got keys {sorted(updates[0])}")

# ---------------------------------------------------------------------------
# 3. The status endpoint returns exactly what was persisted — the value the
#    frontend renders on the "Crawl complete" screen.
# ---------------------------------------------------------------------------
status = _row_to_status(stored)
check("status response carries the persisted new_jobs", status.new_jobs == 4,
      f"got {status.new_jobs}")
check("status response carries every persisted statistic",
      (status.duplicate_jobs_total, status.companies_created,
       status.companies_updated, status.jobs_verified)
      == (1, 1, 1, 5),
      f"got {status}")
check("status response reports the run id", status.id == RUN_ID)
check("status response reports the terminal status", status.status == "success")

# ---------------------------------------------------------------------------
# 4. A genuinely empty crawl still reports zeros.
# ---------------------------------------------------------------------------
rest_empty = FakeRest()
run_crawl_with(rest_empty, [], run_id=OTHER_RUN_ID)
empty = rest_empty.crawl_runs[OTHER_RUN_ID]
check("an empty crawl still reaches a terminal status", empty.get("status") == "success")
check("an empty crawl reports zeros", all(empty.get(k) == 0 for k in PERSISTED_KEYS),
      f"got {[empty.get(k) for k in PERSISTED_KEYS]}")
check("an empty crawl's status response is all zeros",
      _row_to_status(empty).jobs_verified == 0)

# ---------------------------------------------------------------------------
# 5. A failing crawl still persists whatever it counted before the failure.
# ---------------------------------------------------------------------------
class ExplodingRest(FakeRest):
    async def upsert(self, client, table, rows, on_conflict, prefer=""):
        if table == "jobs":
            raise httpx.ConnectError("upstream gone")
        return await super().upsert(client, table, rows, on_conflict, prefer)


rest_failed = ExplodingRest()
run_crawl_with(rest_failed, JOBS, run_id=RUN_ID)
failed = rest_failed.crawl_runs[RUN_ID]
check("a failed crawl is marked error", failed.get("status") == "error",
      f"got {failed.get('status')!r}")
check("a failed crawl still persists the counts it reached",
      failed.get("new_jobs") == 4, f"got {failed.get('new_jobs')}")
check("a failed crawl records the error", bool(failed.get("error_message")))

# ---------------------------------------------------------------------------
# 6. On a table missing only `jobs_found` (the least-confirmed column), the
#    other four confirmed columns still persist — tier 2 of the tiered write.
# ---------------------------------------------------------------------------
rest_no_verified = FakeRest(missing_columns={"jobs_found"})
run_crawl_with(rest_no_verified, JOBS, run_id=RUN_ID)
row_no_verified = rest_no_verified.crawl_runs[RUN_ID]
check("missing jobs_found still reaches a terminal status",
      row_no_verified.get("status") == "success", f"got {row_no_verified.get('status')!r}")
check("missing jobs_found still persists new_jobs (doesn't fall all the way to 0)",
      row_no_verified.get("new_jobs") == 4, f"got {row_no_verified.get('new_jobs')}")
check("missing jobs_found still persists duplicate_jobs",
      row_no_verified.get("duplicate_jobs") == 1, f"got {row_no_verified.get('duplicate_jobs')}")
check("jobs_found itself is simply absent, not zero-and-wrong",
      "jobs_found" not in row_no_verified)
check("this took exactly two attempts (tier 1 failed, tier 2 succeeded)",
      len(crawl_run_updates(rest_no_verified)) == 2,
      f"got {len(crawl_run_updates(rest_no_verified))}")

# ---------------------------------------------------------------------------
# 7. On a table missing every statistics column (a genuinely bare crawl_runs,
#    predating even migration 0001's counters), the run still reaches a
#    terminal state instead of appearing to hang — tier 3, the bare minimum.
# ---------------------------------------------------------------------------
rest_bare = FakeRest(missing_columns=set(PERSISTED_KEYS))
run_crawl_with(rest_bare, JOBS, run_id=RUN_ID)
bare_row = rest_bare.crawl_runs[RUN_ID]
check("a bare table still reaches a terminal status",
      bare_row.get("status") == "success", f"got {bare_row.get('status')!r}")
check("the bare write carries status and completed_at",
      bool(bare_row.get("completed_at")))
check("the bare fallback took exactly three attempts",
      len(crawl_run_updates(rest_bare)) == 3, f"got {len(crawl_run_updates(rest_bare))}")
check("none of the statistics columns were ever accepted",
      not any(k in bare_row for k in PERSISTED_KEYS))

# ---------------------------------------------------------------------------
# 9. CrawlStats.as_persisted_columns covers exactly the confirmed-live
#    column set — no more, no less.
# ---------------------------------------------------------------------------
check("as_persisted_columns() matches the confirmed-live column set",
      set(CrawlStats().as_persisted_columns()) == set(PERSISTED_KEYS),
      f"got {sorted(CrawlStats().as_persisted_columns())}")

# ---------------------------------------------------------------------------
# 10. Against the REAL live schema (an allowlist, so any column the database
#     does not have fails the whole statement), a run reaches a terminal state
#     on its first attempt — success and error alike. This is the scenario the
#     opt-out `missing_columns` fakes could not express: `_finalize` wrote an
#     `error` column that does not exist, in *every* tier, so the tiered write
#     ran out of tiers, re-raised, and left the row at "running" forever.
# ---------------------------------------------------------------------------
def _crawl_or_error(rest, jobs, **kwargs) -> str:
    """Run a crawl, reporting a crashed `run_crawl` as a named failure.

    The bug this scenario covers ends in an unhandled exception out of
    `_finalize`, which would otherwise kill this script with a bare traceback
    instead of telling you which property broke.
    """
    try:
        run_crawl_with(rest, jobs, run_id=RUN_ID, **kwargs)
    except Exception as exc:  # noqa: BLE001 — the failure mode under test
        return f"{type(exc).__name__}: {exc}"
    return ""


rest_live = FakeRest(known_columns=LIVE_CRAWL_RUNS_COLUMNS)
crashed = _crawl_or_error(rest_live, JOBS)
check("run_crawl never raises on the live schema", not crashed, crashed)
live_row = rest_live.crawl_runs.get(RUN_ID, {})
check("on the live schema the run reaches a terminal status",
      live_row.get("status") == "success", f"got {live_row.get('status')!r}")
check("the live schema accepts the full payload on the first attempt",
      len(crawl_run_updates(rest_live)) == 1,
      f"got {len(crawl_run_updates(rest_live))}")
check("every statistic lands on the live schema",
      all(k in live_row for k in PERSISTED_KEYS),
      f"got {sorted(live_row)}")


async def _exploding_fetch_all(client, settings, query, city, sources, stats):
    raise RuntimeError("upstream blew up")


rest_live_error = FakeRest(known_columns=LIVE_CRAWL_RUNS_COLUMNS)
crashed = _crawl_or_error(rest_live_error, [], fetch_all=_exploding_fetch_all)
check("a crawl that fails mid-flight still never raises", not crashed, crashed)
error_row = rest_live_error.crawl_runs.get(RUN_ID, {})
check("a failing crawl reaches a terminal status too, never stays running",
      error_row.get("status") == "error", f"got {error_row.get('status')!r}")
check("the failure reason is written to error_message, the live column name",
      bool(error_row.get("error_message")), f"got {sorted(error_row)}")
check("nothing is ever written to a column named `error`",
      not any("error" in values for values in crawl_run_updates(rest_live_error)))
check("the coach reads that reason back out of the row",
      _row_to_status({**error_row, "started_at": NOW.isoformat()}).error
      == error_row.get("error_message"))

print()
if failures():
    print(f"{len(failures())} FAILED:")
    for failure in failures():
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL CRAWL STATISTICS TESTS PASSED")
