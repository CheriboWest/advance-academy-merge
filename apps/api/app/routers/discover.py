"""Coach-triggered crawler endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.crawler.normalize import normalize_query
from app.crawler.pipeline import run_crawl
from app.crawler.supabase_rest import SupabaseRest
from app.schemas import (
    CrawlRunStatus,
    DiscoverStartRequest,
    DiscoverStartResponse,
)

router = APIRouter(prefix="/discover", tags=["discover"])

VALID_SOURCES = ("adzuna", "reed")
CACHE_TTL_HOURS = 24.0


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
    def _int(key: str) -> int:
        value = row.get(key)
        return int(value) if isinstance(value, (int, float)) else 0

    return CrawlRunStatus(
        id=str(row.get("id")),
        status=str(row.get("status") or "unknown"),
        query=row.get("query"),
        location=row.get("location"),
        jobs_fetched=_int("jobs_fetched"),
        new_jobs=_int("new_jobs"),
        duplicate_jobs=_int("duplicate_jobs"),
        companies_discovered=_int("companies_discovered"),
        companies_updated=_int("companies_updated"),
        lead_scores_recalculated=_int("lead_scores_recalculated"),
        error=row.get("error"),
        created_at=row.get("created_at"),
        finished_at=row.get("finished_at"),
    )


async def _cached_jobs_available(
    client: httpx.AsyncClient, rest: SupabaseRest, query: str, location: str
) -> int:
    rows = await rest.select(
        client,
        "crawl_runs",
        {
            "query": f"eq.{query}",
            "location": f"eq.{location}",
            "status": "eq.completed",
            "select": "jobs_fetched",
            "order": "created_at.desc",
            "limit": "1",
        },
    )
    if rows and isinstance(rows[0].get("jobs_fetched"), (int, float)):
        return int(rows[0]["jobs_fetched"])
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
        # 1. Cache check (unless forced).
        if not req.force:
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

        # 2. Start a run.
        created = await rest.insert(
            client,
            "crawl_runs",
            [
                {
                    "status": "running",
                    "query": normalized_query,
                    "location": normalized_city,
                }
            ],
            prefer="return=representation",
        )

    run_id = str(created[0]["id"])
    background_tasks.add_task(run_crawl, run_id, req.query, req.city, sources)

    return DiscoverStartResponse(cached=False, run_id=run_id, status="running")


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
            {"id": f"eq.{run_id}", "select": "*", "limit": "1"},
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
            {"select": "*", "order": "created_at.desc", "limit": "10"},
        )

    return [_row_to_status(row) for row in rows]
