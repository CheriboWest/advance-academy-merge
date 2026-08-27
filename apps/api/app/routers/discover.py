"""Coach-triggered crawler endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.crawler.normalize import normalize_query
from app.crawler.pipeline import OVERALL_TIMEOUT_SECONDS, run_crawl
from app.crawler.supabase_rest import SupabaseRest
from app.crawler.timing import stage
from app.schemas import (
    CrawlRunStatus,
    DiscoverStartRequest,
    DiscoverStartResponse,
)

router = APIRouter(prefix="/discover", tags=["discover"])

VALID_SOURCES = ("adzuna", "reed")
CACHE_TTL_HOURS = 24.0
# A run still "running" past this is not running — the crawl itself is capped at
# OVERALL_TIMEOUT_SECONDS and always finalizes, so twice that is well clear of a
# slow-but-live crawl. Anything older lost its background task (the server
# restarted, `uvicorn --reload` reloaded, the finalize write failed) and no
# in-process handler can ever come back to it.
STALE_RUN_SECONDS = OVERALL_TIMEOUT_SECONDS * 2


def _require_supabase(settings: Settings) -> SupabaseRest:
    if not (settings.supabase_url and settings.supabase_service_role_key):
        raise HTTPException(
            status_code=500, detail="Server is not configured for Supabase access."
        )
    return SupabaseRest(settings.supabase_url, settings.supabase_service_role_key)


def _hours_since(iso: Optional[str]) -> Optional[float]:
    if not iso:
        return None
    try:
        parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - parsed
    return delta.total_seconds() / 3600.0


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
    age_hours = _hours_since(row.get("started_at"))
    if (
        status == "running"
        and age_hours is not None
        and age_hours * 3600.0 > STALE_RUN_SECONDS
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

    normalized_query = normalize_query(req.query)
    normalized_city = normalize_query(req.city)

    if not normalized_query or not normalized_city:
        raise HTTPException(status_code=422, detail="Query and city are required.")

    sources = [s for s in req.sources if s in VALID_SOURCES] or list(VALID_SOURCES)

    async with httpx.AsyncClient() as client:
        # 1. Cache check (unless forced)
        if not req.force:
            with stage("cache_check"):
                existing = await rest.select(
                    client,
                    "discovery_queries",
                    {
                        "query": f"eq.{normalized_query}",
                        "location": f"eq.{normalized_city}",
                        "select": "*",
                        "limit": "1",
                    },
                )

            if existing:
                last_refreshed = existing[0].get("last_refreshed_at")
                hours = _hours_since(last_refreshed)

                if hours is not None and hours < CACHE_TTL_HOURS:
                    jobs_available = await _cached_jobs_available(
                        client, rest, normalized_query, normalized_city
                    )

                    return DiscoverStartResponse(
                        cached=True,
                        last_refreshed_at=last_refreshed,
                        hours_ago=round(hours, 1),
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
                        "query": req.query,
                        "location": req.city,
                    }
                ],
            )

    run_id = str(created[0]["id"])

    background_tasks.add_task(run_crawl, run_id, req.query, req.city, sources)

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
