"""Adzuna API source adapter."""

from __future__ import annotations

from typing import Optional

import httpx

from app.crawler.models import NormalizedJob

ADZUNA_URL = "https://api.adzuna.com/v1/api/jobs/gb/search/1"

REQUEST_TIMEOUT = 20.0


def _to_int(value: object) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


async def fetch(
    client: httpx.AsyncClient,
    app_id: str,
    app_key: str,
    query: str,
    city: str,
    limit: int = 25,
) -> list[NormalizedJob]:
    """Fetch jobs from Adzuna. Raises on transport/HTTP errors."""
    params = {
        "app_id": app_id,
        "app_key": app_key,
        "what": query,
        "where": city,
        "results_per_page": limit,
        "content-type": "application/json",
    }
    response = await client.get(ADZUNA_URL, params=params, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()

    jobs: list[NormalizedJob] = []
    for result in data.get("results", []):
        company = (result.get("company") or {}).get("display_name") or "Unknown"
        location = (result.get("location") or {}).get("display_name") or city
        jobs.append(
            NormalizedJob(
                source="adzuna",
                source_job_id=str(result.get("id", "")),
                company_name=company,
                title=result.get("title") or "",
                city=location,
                location_raw=location,
                salary_min=_to_int(result.get("salary_min")),
                salary_max=_to_int(result.get("salary_max")),
                source_url=result.get("redirect_url"),
                posted_at=result.get("created"),
            )
        )
    return jobs
