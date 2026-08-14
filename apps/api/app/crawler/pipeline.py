"""Crawl pipeline: fetch → normalize → dedup → ingest → score → record stats."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

import httpx

from app.config import get_settings
from app.crawler.enrich import enrich_company
from app.crawler.models import CrawlStats, NormalizedJob
from app.crawler.normalize import (
    canonical_company_name,
    company_slug,
    content_hash,
    normalize_city,
    normalize_query,
    normalize_title,
)
from app.crawler.scoring import compute_lead_score
from app.crawler.sources import adzuna, reed
from app.crawler.supabase_rest import SupabaseRest


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_error(exc: Exception) -> str:
    """A message safe to store/log — never includes URLs or credentials.

    (Adzuna passes app_id/app_key as query params, so the raw error string can
    leak secrets — we deliberately avoid stringifying the exception.)
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code} from upstream source."
    if isinstance(exc, httpx.TimeoutException):
        return "Upstream request timed out."
    if isinstance(exc, httpx.HTTPError):
        return "Upstream request failed."
    return "Unexpected error during crawl."


def _csv(values: Iterable[str]) -> str:
    return ",".join(values)


def _chunks(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


async def _fetch_all(
    client: httpx.AsyncClient,
    settings: Any,
    query: str,
    city: str,
    sources: list[str],
    stats: CrawlStats,
) -> list[NormalizedJob]:
    jobs: list[NormalizedJob] = []

    if "adzuna" in sources:
        if settings.adzuna_app_id and settings.adzuna_app_key:
            try:
                jobs += await adzuna.fetch(
                    client,
                    settings.adzuna_app_id,
                    settings.adzuna_app_key,
                    query,
                    city,
                )
            except Exception as exc:  # noqa: BLE001 - partial failure is expected
                stats.source_errors["adzuna"] = _safe_error(exc)
        else:
            stats.source_errors["adzuna"] = "Adzuna credentials not configured."

    if "reed" in sources:
        if settings.reed_api_key:
            try:
                jobs += await reed.fetch(client, settings.reed_api_key, query, city)
            except Exception as exc:  # noqa: BLE001 - partial failure is expected
                stats.source_errors["reed"] = _safe_error(exc)
        else:
            stats.source_errors["reed"] = "Reed credentials not configured."

    return jobs


async def _ingest(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    jobs: list[NormalizedJob],
    stats: CrawlStats,
) -> None:
    if not jobs:
        return

    # Group jobs by canonical company slug.
    groups: dict[str, dict[str, Any]] = {}
    for job in jobs:
        slug = company_slug(job.company_name)
        group = groups.setdefault(
            slug, {"name": canonical_company_name(job.company_name), "jobs": []}
        )
        group["jobs"].append(job)

    slugs = list(groups.keys())
    existing_companies = await rest.select(
        client,
        "companies",
        {
            "slug": f"in.({_csv(slugs)})",
            "select": "id,slug,website,sector",
        },
    )
    existing_by_slug = {row["slug"]: row for row in existing_companies}

    # Build company rows (enrich + score).
    company_rows: list[dict[str, Any]] = []
    for slug, group in groups.items():
        group_jobs: list[NormalizedJob] = group["jobs"]
        prior = existing_by_slug.get(slug)
        website = (prior or {}).get("website")

        enrichment = await enrich_company(client, website)
        sector = enrichment.get("sector") or (prior or {}).get("sector")
        score = compute_lead_score(group_jobs, sector=sector)
        hq = normalize_city(group_jobs[0].city) if group_jobs else None

        row: dict[str, Any] = {
            "slug": slug,
            "name": group["name"],
            "hq_location": hq,
            "region": hq,
            "lead_score": score,
        }
        if enrichment.get("description"):
            row["description"] = enrichment["description"]
        if sector:
            row["sector"] = sector
        if enrichment.get("careers_url"):
            row["careers_url"] = enrichment["careers_url"]

        company_rows.append(row)
        stats.lead_scores_recalculated += 1
        if prior:
            stats.companies_updated += 1
        else:
            stats.companies_discovered += 1

    upserted = await rest.upsert(
        client,
        "companies",
        company_rows,
        on_conflict="slug",
        prefer="resolution=merge-duplicates,return=representation",
    )
    company_id_by_slug = {row["slug"]: row["id"] for row in upserted}

    # Build deduplicated job rows.
    job_rows: list[dict[str, Any]] = []
    seen_hashes: set[str] = set()
    for slug, group in groups.items():
        company_id = company_id_by_slug.get(slug)
        if not company_id:
            continue
        for job in group["jobs"]:
            digest = content_hash(slug, job.title, job.city)
            if digest in seen_hashes:
                stats.duplicate_jobs += 1
                continue
            seen_hashes.add(digest)
            job_rows.append(
                {
                    "company_id": company_id,
                    "title": normalize_title(job.title),
                    "location_raw": job.location_raw or job.city,
                    "city": normalize_city(job.city),
                    "salary_min": job.salary_min,
                    "salary_max": job.salary_max,
                    "posted_at": job.posted_at,
                    "is_active": True,
                    "source": job.source,
                    "source_job_id": job.source_job_id,
                    "source_url": job.source_url,
                    "content_hash": digest,
                }
            )

    # Skip jobs whose content_hash already exists (the dedup strategy).
    all_hashes = [row["content_hash"] for row in job_rows]
    existing_hashes: set[str] = set()
    for chunk in _chunks(all_hashes, 100):
        rows = await rest.select(
            client,
            "jobs",
            {"content_hash": f"in.({_csv(chunk)})", "select": "content_hash"},
        )
        existing_hashes.update(row["content_hash"] for row in rows)

    new_rows = [row for row in job_rows if row["content_hash"] not in existing_hashes]
    stats.duplicate_jobs += len(job_rows) - len(new_rows)
    stats.new_jobs = len(new_rows)

    for chunk in _chunks(new_rows, 100):
        await rest.upsert(
            client,
            "jobs",
            chunk,
            on_conflict="content_hash",
            prefer="resolution=ignore-duplicates,return=minimal",
        )


async def run_crawl(
    run_id: str, query: str, city: str, sources: list[str]
) -> None:
    """Background entrypoint: run the full crawl and record results/errors."""
    settings = get_settings()
    rest = SupabaseRest(settings.supabase_url, settings.supabase_service_role_key)
    stats = CrawlStats()

    normalized_query = normalize_query(query)
    normalized_city = normalize_query(city)

    try:
        async with httpx.AsyncClient() as client:
            jobs = await _fetch_all(client, settings, query, city, sources, stats)
            stats.jobs_fetched = len(jobs)

            await _ingest(client, rest, jobs, stats)

            # Refresh the 24h cache marker.
            await rest.upsert(
                client,
                "discovery_queries",
                [
                    {
                        "query": normalized_query,
                        "location": normalized_city,
                        "last_refreshed_at": _now_iso(),
                    }
                ],
                on_conflict="query,location",
                prefer="resolution=merge-duplicates,return=minimal",
            )

            note = None
            if stats.source_errors:
                note = "; ".join(
                    f"{source}: {message}"
                    for source, message in stats.source_errors.items()
                )

            await rest.update(
                client,
                "crawl_runs",
                {"id": f"eq.{run_id}"},
                {
                    "status": "completed",
                    "finished_at": _now_iso(),
                    "error": note,
                    **stats.as_columns(),
                },
            )
    except Exception as exc:  # noqa: BLE001 - record failure, never raise
        try:
            async with httpx.AsyncClient() as client:
                await rest.update(
                    client,
                    "crawl_runs",
                    {"id": f"eq.{run_id}"},
                    {
                        "status": "failed",
                        "finished_at": _now_iso(),
                        "error": _safe_error(exc),
                        **stats.as_columns(),
                    },
                )
        except Exception:  # noqa: BLE001 - swallow bookkeeping failures
            pass
