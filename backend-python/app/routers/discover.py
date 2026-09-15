"""Coach-triggered crawler endpoints."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.crawler.normalize import normalize_query, split_terms
from app.crawler.pipeline import (
    OVERALL_TIMEOUT_SECONDS,
    cached_refresh_time,
    hours_since,
    run_crawl,
)
from app.crawler.supabase_rest import SupabaseRest
from app.crawler.timing import stage
from app.schemas import (
    CrawlRunStatus,
    DiscoverStartRequest,
    DiscoverStartResponse,
)

router = APIRouter(prefix="/discover", tags=["discover"])

VALID_SOURCES = ("adzuna", "reed")
# One coach action can crawl a list of roles across a list of cities. The cap is
# the provider budget rather than anything about this process: a pair costs one
# request per source, and Adzuna's free tier allows 250 a day.
MAX_PAIRS_PER_RUN = 25
# A run still "running" past this is not running — each pair is capped at
# OVERALL_TIMEOUT_SECONDS and the run always finalizes, so twice that per pair
# is well clear of a slow-but-live crawl. Anything older lost its background
# task (the server restarted, `uvicorn --reload` reloaded, the finalize write
# failed) and no in-process handler can ever come back to it.
STALE_RUN_SECONDS = OVERALL_TIMEOUT_SECONDS * 2


def _require_supabase(settings: Settings) -> SupabaseRest:
    if not (settings.supabase_url and settings.supabase_service_role_key):
        raise HTTPException(
            status_code=500, detail="Server is not configured for Supabase access."
        )
    return SupabaseRest(settings.supabase_url, settings.supabase_service_role_key)


def _row_to_status(row: dict[str, Any]) -> CrawlRunStatus:
    """Map a `crawl_runs` row to the API response.

    Reads the columns `_finalize` actually writes to (see
    `CrawlStats.as_persisted_columns`): `new_jobs`, `duplicate_jobs`,
    `companies_discovered`, `companies_updated`, `jobs_found` — all
    confirmed live on a real completed run's row. It deliberately does NOT
    read `raw_jobs`/`normalized_jobs`/`inserted_jobs`/`companies_created` —
    those migration-0002/0005 columns are never written by this code, so
    reading them back would always yield 0 regardless of what the crawl
    actually did.

    The legacy `raw_jobs`/`normalized_jobs`/`inserted_jobs`/`updated_jobs`/
    `companies_created` fields on `CrawlRunStatus` still exist (the "Recent
    crawls" history table binds to some of them) and are filled in as the
    closest honest approximation from the same real columns, rather than
    left to read back as a permanent, misleading 0.

    The failure text comes from `error_message`, the live column's real name —
    reading `error` (which does not exist) always yielded None, so a coach
    never saw why a crawl failed.

    A run left at "running" past `STALE_RUN_SECONDS` is reported as an error:
    its background task is gone and no one is coming back to finalize it.
    """

    def _int(key: str) -> int:
        value = row.get(key)
        return int(value) if isinstance(value, (int, float)) else 0

    status = str(row.get("status") or "unknown")
    error = row.get("error_message")

    # ponytail: derived at read time, the row in the database stays "running".
    # That is deliberate — it needs no write path, no cron, and it covers every
    # cause including a killed process. Upgrade to a background reaper only if
    # something starts reading crawl_runs.status directly (a report, a metric).
    #
    # The budget scales with what the run was actually asked to do: `query` and
    # `location` hold the pair lists verbatim, so the row itself says how many
    # crawls are in flight — no extra column on a table with known schema drift.
    pair_count = max(
        1,
        len(split_terms(str(row.get("query") or "")))
        * len(split_terms(str(row.get("location") or ""))),
    )
    age_hours = hours_since(row.get("started_at"))
    if (
        status == "running"
        and age_hours is not None
        and age_hours * 3600.0 > STALE_RUN_SECONDS * pair_count
    ):
        status = "error"
        error = error or "The crawl was interrupted and never finished."

    new_jobs = _int("new_jobs")
    duplicate_jobs = _int("duplicate_jobs")
    companies_created = _int("companies_discovered")
    companies_updated = _int("companies_updated")
    jobs_verified = _int("jobs_found")

    return CrawlRunStatus(
        id=str(row.get("id")),
        status=status,
        query=row.get("query"),
        location=row.get("location"),
        # Best-effort approximations — the live schema has no separate raw/
        # normalized/updated counters, only the four fields above.
        raw_jobs=jobs_verified,
        normalized_jobs=jobs_verified,
        inserted_jobs=new_jobs,
        updated_jobs=0,
        duplicate_jobs=duplicate_jobs,
        companies_created=companies_created,
        companies_updated=companies_updated,
        new_jobs=new_jobs,
        duplicate_jobs_total=duplicate_jobs,
        jobs_verified=jobs_verified,
        error=error,
        created_at=row.get("started_at"),   # use started_at
        finished_at=row.get("completed_at"), # use completed_at
    )


async def _cached_jobs_available(
    client: httpx.AsyncClient, rest: SupabaseRest, query: str, location: str
) -> int:
    """Jobs available for a cached (query, location) — read back from
    whichever run last refreshed it.

    Was selecting `jobs_found` but reading back `raw_jobs`, a column this
    code never asked for and that PostgREST would never include in the
    result — so this always returned 0 regardless of what the cached run
    actually found. Fixed to read the column it selects.
    """
    rows = await rest.select(
        client,
        "crawl_runs",
        { "query": f"eq.{query}", "location": f"eq.{location}", "status": "eq.success", "select": "jobs_found", "order": "started_at.desc", "limit": "1", },
    )
    if rows and isinstance(rows[0].get("jobs_found"), (int, float)):
        return int(rows[0]["jobs_found"])
    return 0


@router.post("/start", response_model=DiscoverStartResponse)
async def start_discovery(
    req: DiscoverStartRequest,
    background_tasks: BackgroundTasks,
    _user_id: str = Depends(get_current_user),
) -> DiscoverStartResponse:
    settings = get_settings()
    rest = _require_supabase(settings)

    # Both fields accept a list (newlines and/or commas), so one action can
    # cover many roles. Everything downstream still passes plain strings —
    # `run_crawl` re-splits them — which is why no schema or signature changes.
    queries = split_terms(req.query)
    cities = split_terms(req.city)

    if not queries or not cities:
        raise HTTPException(status_code=422, detail="Query and city are required.")

    pairs = [(q, c) for q in queries for c in cities]
    if len(pairs) > MAX_PAIRS_PER_RUN:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{len(queries)} role(s) x {len(cities)} city/cities = "
                f"{len(pairs)} crawls, over the limit of {MAX_PAIRS_PER_RUN}. "
                "Shorten the list or split it across two runs."
            ),
        )

    sources = [s for s in req.sources if s in VALID_SOURCES] or list(VALID_SOURCES)

    # Stored as one line so a pasted 20-row list does not wreck the "Recent
    # crawls" cell. For a single role this is the input unchanged.
    stored_query = ", ".join(queries)
    stored_city = ", ".join(cities)

    async with httpx.AsyncClient() as client:
        # 1. Cache check (unless forced). Every pair still fresh means there is
        #    nothing to crawl — the same answer the single-pair case has always
        #    given, so it reuses the same response and its "Refresh now" button.
        #    A partially fresh list is a real run: `run_crawl` skips the fresh
        #    pairs itself, which is also what makes an interrupted run resumable.
        if not req.force:
            with stage("cache_check"):
                markers = await asyncio.gather(
                    *[
                        cached_refresh_time(
                            client, rest, normalize_query(q), normalize_query(c)
                        )
                        for q, c in pairs
                    ]
                )

            if all(markers):
                # Report the age of the stalest pair — the honest one, since it
                # is the first that would be recrawled.
                oldest = max(markers, key=lambda m: hours_since(m) or 0.0)
                hours = hours_since(oldest)
                # Only meaningful per pair: a multi-pair run records one
                # crawl_runs row for the whole list, so there is no per-pair
                # figure to read back. None renders as "no count", not "zero".
                jobs_available = None
                if len(pairs) == 1:
                    jobs_available = await _cached_jobs_available(
                        client,
                        rest,
                        normalize_query(pairs[0][0]),
                        normalize_query(pairs[0][1]),
                    )

                return DiscoverStartResponse(
                    cached=True,
                    last_refreshed_at=oldest,
                    hours_ago=round(hours, 1) if hours is not None else None,
                    jobs_available=jobs_available,
                )

        # 2. Start a run
        with stage("create_crawl_run"):
            created = await rest.insert(
                client,
                "crawl_runs",
                [
                    {
                        "source": "manual_discovery",
                        "status": "running",
                        "query": stored_query,
                        "location": stored_city,
                    }
                ],
            )

    run_id = str(created[0]["id"])

    background_tasks.add_task(
        run_crawl, run_id, stored_query, stored_city, sources, req.force
    )

    return DiscoverStartResponse(
        cached=False,
        run_id=run_id,
        status="running",
    )


@router.get("/status/{run_id}", response_model=CrawlRunStatus)
async def discovery_status(
    run_id: str,
    _user_id: str = Depends(get_current_user),
) -> CrawlRunStatus:
    settings = get_settings()
    rest = _require_supabase(settings)

    async with httpx.AsyncClient() as client:
        rows = await rest.select(
            client,
            "crawl_runs",
            {
                "id": f"eq.{run_id}",
                "select": "*",
                "limit": "1",
            },
        )

    if not rows:
        raise HTTPException(status_code=404, detail="Crawl run not found.")

    return _row_to_status(rows[0])


@router.get("/history", response_model=list[CrawlRunStatus])
async def discovery_history(
    _user_id: str = Depends(get_current_user),
) -> list[CrawlRunStatus]:
    settings = get_settings()
    rest = _require_supabase(settings)

    async with httpx.AsyncClient() as client:
        rows = await rest.select(
            client,
            "crawl_runs",
            {
                "select": "*",
                "order": "started_at.desc",
                "limit": "10",
            },
        )

    return [_row_to_status(row) for row in rows]
