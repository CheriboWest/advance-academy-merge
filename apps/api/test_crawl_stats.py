"""Self-check for crawl statistics: `python test_crawl_stats.py` (no pytest).

Regression cover for the bug where a finished crawl reported zeros for work it
had actually done: the pipeline counted into `CrawlStats`, but `_finalize`
wrote only `status` + `completed_at`, so the counts never reached `crawl_runs`
and the status endpoint read them back as 0.

Runs offline: a fake `SupabaseRest` stands in for the database and the job
sources are stubbed, so no network and no Supabase project are involved.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

from app.crawler import pipeline
from app.crawler.models import CrawlStats, NormalizedJob
from app.routers.discover import _row_to_status

NOW = datetime.now(timezone.utc)
RUN_ID = "11111111-1111-1111-1111-111111111111"
OTHER_RUN_ID = "22222222-2222-2222-2222-222222222222"

STAT_KEYS = (
    "raw_jobs",
    "normalized_jobs",
    "inserted_jobs",
    "updated_jobs",
    "duplicate_jobs",
    "companies_created",
    "companies_updated",
)

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


def crawled(title: str, company: str, days_ago: float = 1) -> NormalizedJob:
    return NormalizedJob(
        source="adzuna",
        source_job_id=f"{company}:{title}",
        company_name=company,
        title=title,
        city="London",
        location_raw="London",
        posted_at=(NOW - timedelta(days=days_ago)).isoformat(),
    )


class FakeRest:
    """In-memory stand-in for SupabaseRest, recording every write."""

    def __init__(
        self,
        companies: Optional[list[dict]] = None,
        jobs: Optional[list[dict]] = None,
        missing_stat_columns: bool = False,
    ) -> None:
        self.companies = companies or []
        self.jobs = jobs or []
        self.crawl_runs: dict[str, dict] = {}
        self.updates: list[tuple[str, dict, dict]] = []
        # Emulates a database that predates migration 0005.
        self.missing_stat_columns = missing_stat_columns

    async def select(self, client, table, params=None):
        params = params or {}
        if table == "companies":
            wanted = _in_list(params.get("slug", ""))
            return [c for c in self.companies if c["slug"] in wanted]
        if table == "jobs":
            if "content_hash" in params:
                wanted = _in_list(params["content_hash"])
                return [{"content_hash": h}
                        for h in {j.get("content_hash") for j in self.jobs}
                        if h in wanted]
            wanted = _in_list(params.get("company_id", ""))
            return [j for j in self.jobs
                    if j.get("company_id") in wanted and j.get("is_active")]
        return []

    async def insert(self, client, table, rows, prefer="return=representation"):
        return rows

    async def upsert(self, client, table, rows, on_conflict, prefer=""):
        if table == "companies":
            out = []
            for row in rows:
                if on_conflict == "id":
                    target = next(c for c in self.companies if c["id"] == row["id"])
                    target.update(row)
                    out.append({"slug": target["slug"], "id": target["id"]})
                else:
                    existing = next(
                        (c for c in self.companies if c["slug"] == row["slug"]), None
                    )
                    if existing:
                        existing.update(row)
                    else:
                        existing = {**row, "id": f"new:{row['slug']}"}
                        self.companies.append(existing)
                    out.append({"slug": existing["slug"], "id": existing["id"]})
            return out
        if table == "jobs":
            for row in rows:
                existing = next(
                    (j for j in self.jobs
                     if j.get("content_hash") == row.get("content_hash")), None)
                if existing:
                    existing.update(row)
                else:
                    self.jobs.append({**row, "id": f"job:{row.get('content_hash')}"})
        return []

    async def update(self, client, table, match, values, prefer="return=minimal"):
        self.updates.append((table, dict(match), dict(values)))

        if table == "crawl_runs" and self.missing_stat_columns:
            unknown = [k for k in values if k in STAT_KEYS or k == "error"]
            if unknown:
                request = httpx.Request("PATCH", "https://example.test/crawl_runs")
                response = httpx.Response(
                    400,
                    json={
                        "code": "PGRST204",
                        "message": (
                            f"Column '{unknown[0]}' of relation 'crawl_runs' "
                            "does not exist"
                        ),
                    },
                    request=request,
                )
                raise httpx.HTTPStatusError(
                    "bad request", request=request, response=response
                )

        if table == "crawl_runs":
            run_id = match.get("id", "").removeprefix("eq.")
            self.crawl_runs.setdefault(run_id, {"id": run_id}).update(values)


def _in_list(raw: str) -> set[str]:
    if not raw.startswith("in.("):
        return set()
    return {v for v in raw[4:-1].split(",") if v}


class FakeSettings:
    supabase_url = "https://example.supabase.co"
    supabase_service_role_key = "service-role-test-key"
    adzuna_app_id = "id"
    adzuna_app_key = "key"
    reed_api_key = "key"


def run_crawl_with(rest: FakeRest, jobs: list[NormalizedJob], run_id: str = RUN_ID):
    """Drive the real `run_crawl` with the network and database stubbed out."""
    original_settings = pipeline.get_settings
    original_rest_cls = pipeline.SupabaseRest
    original_fetch = pipeline._fetch_all

    async def fake_fetch_all(client, settings, query, city, sources, stats):
        return list(jobs)

    pipeline.get_settings = lambda: FakeSettings()  # type: ignore[assignment]
    pipeline.SupabaseRest = lambda *a, **k: rest  # type: ignore[assignment]
    pipeline._fetch_all = fake_fetch_all  # type: ignore[assignment]
    try:
        asyncio.run(pipeline.run_crawl(run_id, "software engineer", "London",
                                       ["adzuna"]))
    finally:
        pipeline.get_settings = original_settings  # type: ignore[assignment]
        pipeline.SupabaseRest = original_rest_cls  # type: ignore[assignment]
        pipeline._fetch_all = original_fetch  # type: ignore[assignment]


def crawl_run_updates(rest: FakeRest) -> list[dict]:
    return [values for table, _, values in rest.updates if table == "crawl_runs"]


# ---------------------------------------------------------------------------
# 1. A crawl that ingests real data persists non-zero statistics.
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
run_crawl_with(rest, JOBS)

stored = rest.crawl_runs[RUN_ID]
check("the run reached a terminal status", stored.get("status") == "success",
      f"got {stored.get('status')!r}")
check("raw_jobs persisted", stored.get("raw_jobs") == 5, f"got {stored.get('raw_jobs')}")
check("normalized_jobs persisted", stored.get("normalized_jobs") == 4,
      f"got {stored.get('normalized_jobs')}")
check("duplicate_jobs persisted", stored.get("duplicate_jobs") == 1,
      f"got {stored.get('duplicate_jobs')}")
check("inserted_jobs persisted", stored.get("inserted_jobs") == 4,
      f"got {stored.get('inserted_jobs')}")
check("updated_jobs persisted", stored.get("updated_jobs") == 0,
      f"got {stored.get('updated_jobs')}")
check("companies_updated persisted (Acme already existed)",
      stored.get("companies_updated") == 1, f"got {stored.get('companies_updated')}")
check("companies_created persisted (ByteCorp is new)",
      stored.get("companies_created") == 1, f"got {stored.get('companies_created')}")
check("statistics are not all zero",
      any(stored.get(k) for k in STAT_KEYS))

# ---------------------------------------------------------------------------
# 2. Statistics land on THAT run's row, in the SAME write as the status, so a
#    poll can never observe a terminal status alongside zeroed counts.
# ---------------------------------------------------------------------------
updates = crawl_run_updates(rest)
check("crawl_runs is written exactly once", len(updates) == 1, f"got {len(updates)}")
check("status and statistics share a single UPDATE",
      "status" in updates[0] and all(k in updates[0] for k in STAT_KEYS))
check("the write is addressed to this run_id",
      all(match.get("id") == f"eq.{RUN_ID}"
          for table, match, _ in rest.updates if table == "crawl_runs"))
check("no other run row was touched", OTHER_RUN_ID not in rest.crawl_runs)
check("completed_at is set alongside the statistics", bool(updates[0].get("completed_at")))
check("the terminal write never resets a statistic to 0 after setting it",
      all(updates[0][k] == stored[k] for k in STAT_KEYS))

# ---------------------------------------------------------------------------
# 3. The status endpoint returns exactly what was persisted — the value the
#    frontend renders on the "Crawl complete" screen.
# ---------------------------------------------------------------------------
status = _row_to_status(stored)
check("status response carries the persisted raw_jobs", status.raw_jobs == 5)
check("status response carries every persisted statistic",
      (status.normalized_jobs, status.inserted_jobs, status.updated_jobs,
       status.duplicate_jobs, status.companies_created, status.companies_updated)
      == (4, 4, 0, 1, 1, 1),
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
check("an empty crawl reports zeros", all(empty.get(k) == 0 for k in STAT_KEYS),
      f"got {[empty.get(k) for k in STAT_KEYS]}")
check("an empty crawl's status response is all zeros",
      _row_to_status(empty).raw_jobs == 0)

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
      failed.get("raw_jobs") == 5, f"got {failed.get('raw_jobs')}")
check("a failed crawl records the error", bool(failed.get("error")))

# ---------------------------------------------------------------------------
# 6. On a database without the statistics columns (migration 0005 not applied),
#    the run still reaches a terminal state instead of appearing to hang.
# ---------------------------------------------------------------------------
rest_old = FakeRest(missing_stat_columns=True)
run_crawl_with(rest_old, JOBS, run_id=RUN_ID)
old_row = rest_old.crawl_runs[RUN_ID]
check("an un-migrated database still reaches a terminal status",
      old_row.get("status") == "success", f"got {old_row.get('status')!r}")
check("the fallback write carries status and completed_at",
      bool(old_row.get("completed_at")))
check("the fallback is a retry, not a silent skip",
      len(crawl_run_updates(rest_old)) == 2, f"got {len(crawl_run_updates(rest_old))}")
check("the first attempt did include the statistics",
      all(k in crawl_run_updates(rest_old)[0] for k in STAT_KEYS))

# ---------------------------------------------------------------------------
# 7. CrawlStats.as_columns covers exactly the persisted statistic columns.
# ---------------------------------------------------------------------------
check("as_columns() matches the persisted statistic set",
      set(CrawlStats().as_columns()) == set(STAT_KEYS),
      f"got {sorted(CrawlStats().as_columns())}")

print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL CRAWL STATISTICS TESTS PASSED")
