"""Shared test doubles for the crawl-pipeline self-check scripts.

Not itself a test — `test_crawl_stats.py` and `test_crawl_display_stats.py`
both import from here so the in-memory Supabase stand-in and the
`run_crawl_with` driver are defined exactly once.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from app.crawler import pipeline
from app.crawler.models import NormalizedJob

NOW = datetime.now(timezone.utc)

# The crawl_runs columns _finalize actually persists to (confirmed live —
# see CrawlStats.as_persisted_columns). NOT the migration-0002/0005 columns
# (raw_jobs, normalized_jobs, inserted_jobs, companies_created, updated_jobs)
# — those are never written; a table with only them and not these would look
# identical, to this fake, to one with neither.
PERSISTED_KEYS = (
    "new_jobs",
    "duplicate_jobs",
    "companies_discovered",
    "companies_updated",
    "jobs_found",
)

# The columns migrations 0002/0005 added, which this codebase's _finalize
# must NEVER attempt to write — that was the root cause of every statistic
# being silently discarded (see test_crawl_stats.py scenario 8).
UNPERSISTED_LEGACY_KEYS = (
    "raw_jobs",
    "normalized_jobs",
    "inserted_jobs",
    "companies_created",
    "updated_jobs",
)

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


def failures() -> list[str]:
    return _failures


def crawled(
    title: str, company: str, days_ago: float = 1, source: str = "adzuna"
) -> NormalizedJob:
    return NormalizedJob(
        source=source,
        source_job_id=f"{source}:{company}:{title}",
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
        missing_columns: Optional[set] = None,
    ) -> None:
        self.companies = companies or []
        self.jobs = jobs or []
        self.crawl_runs: dict[str, dict] = {}
        self.updates: list[tuple[str, dict, dict]] = []
        # Column names this fake table does NOT have. A crawl_runs UPDATE
        # touching any of them fails the *entire* statement — matching real
        # Postgres/PostgREST all-or-nothing UPDATE semantics — not just that
        # field.
        self.missing_columns = missing_columns or set()

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

        if table == "crawl_runs":
            unknown = [k for k in values if k in self.missing_columns]
            if unknown:
                request = httpx.Request("PATCH", "https://example.test/crawl_runs")
                response = httpx.Response(
                    400,
                    json={
                        "code": "PGRST204",
                        "message": (
                            f"Could not find the '{unknown[0]}' column of "
                            "'crawl_runs' in the schema cache"
                        ),
                    },
                    request=request,
                )
                # Real Postgres UPDATEs are all-or-nothing: none of `values`
                # is applied when any column is unknown.
                raise httpx.HTTPStatusError(
                    "bad request", request=request, response=response
                )

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


def run_crawl_with(
    rest: FakeRest,
    jobs: list[NormalizedJob],
    run_id: str,
    sources: Optional[list[str]] = None,
    fetch_all=None,
):
    """Drive the real `run_crawl` with the network and database stubbed out.

    By default `_fetch_all` is stubbed to return `jobs` verbatim regardless of
    `sources` — good enough for single-source scenarios. Pass `fetch_all` (an
    async callable matching `_fetch_all`'s signature) to exercise real
    multi-source merging instead.
    """
    import asyncio

    original_settings = pipeline.get_settings
    original_rest_cls = pipeline.SupabaseRest
    original_fetch = pipeline._fetch_all

    async def default_fetch_all(client, settings, query, city, sources, stats):
        return list(jobs)

    pipeline.get_settings = lambda: FakeSettings()  # type: ignore[assignment]
    pipeline.SupabaseRest = lambda *a, **k: rest  # type: ignore[assignment]
    pipeline._fetch_all = fetch_all or default_fetch_all  # type: ignore[assignment]
    try:
        asyncio.run(
            pipeline.run_crawl(
                run_id, "software engineer", "London", sources or ["adzuna"]
            )
        )
    finally:
        pipeline.get_settings = original_settings  # type: ignore[assignment]
        pipeline.SupabaseRest = original_rest_cls  # type: ignore[assignment]
        pipeline._fetch_all = original_fetch  # type: ignore[assignment]


def crawl_run_updates(rest: FakeRest) -> list[dict]:
    return [values for table, _, values in rest.updates if table == "crawl_runs"]
