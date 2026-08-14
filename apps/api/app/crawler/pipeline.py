"""Crawl pipeline: fetch → normalize → dedup → ingest → score → record stats."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Iterable

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
from app.crawler.timing import log_stage, stage

# MVP limits.
MAX_RAW_JOBS = 50
PER_SOURCE_LIMIT = 25
# Hard ceiling so a background task can never stay "running" forever.
OVERALL_TIMEOUT_SECONDS = 90.0


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


async def _fetch_source(
    name: str,
    coro: Awaitable[list[NormalizedJob]],
    stats: CrawlStats,
) -> list[NormalizedJob]:
    """Await a single source, timing it and isolating its failure."""
    start = time.perf_counter()
    try:
        return await coro
    except Exception as exc:  # noqa: BLE001 - partial failure is expected
        stats.source_errors[name] = _safe_error(exc)
        return []
    finally:
        log_stage(f"fetch:{name}", time.perf_counter() - start)


async def _fetch_all(
    client: httpx.AsyncClient,
    settings: Any,
    query: str,
    city: str,
    sources: list[str],
    stats: CrawlStats,
) -> list[NormalizedJob]:
    """Fetch up to MAX_RAW_JOBS. Sources run concurrently; failures are isolated."""
    tasks: list[Awaitable[list[NormalizedJob]]] = []

    if "adzuna" in sources:
        if settings.adzuna_app_id and settings.adzuna_app_key:
            tasks.append(
                _fetch_source(
                    "adzuna",
                    adzuna.fetch(
                        client,
                        settings.adzuna_app_id,
                        settings.adzuna_app_key,
                        query,
                        city,
                        limit=PER_SOURCE_LIMIT,
                    ),
                    stats,
                )
            )
        else:
            stats.source_errors["adzuna"] = "Adzuna credentials not configured."

    if "reed" in sources:
        if settings.reed_api_key:
            tasks.append(
                _fetch_source(
                    "reed",
                    reed.fetch(
                        client,
                        settings.reed_api_key,
                        query,
                        city,
                        limit=PER_SOURCE_LIMIT,
                    ),
                    stats,
                )
            )
        else:
            stats.source_errors["reed"] = "Reed credentials not configured."

    # Run all sources concurrently — total time is the slowest source, not the sum.
    results = await asyncio.gather(*tasks) if tasks else []

    jobs: list[NormalizedJob] = []
    for result in results:
        if len(jobs) >= MAX_RAW_JOBS:
            break
        jobs.extend(result[:PER_SOURCE_LIMIT])
        jobs = jobs[:MAX_RAW_JOBS]
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
    with stage("group_by_company"):
        groups: dict[str, dict[str, Any]] = {}
        for job in jobs:
            slug = company_slug(job.company_name)
            group = groups.setdefault(
                slug, {"name": canonical_company_name(job.company_name), "jobs": []}
            )
            group["jobs"].append(job)
        slugs = list(groups.keys())

    with stage("select_companies", f"({len(slugs)} slugs)"):
        existing_companies = await rest.select(
            client,
            "companies",
            {"slug": f"in.({_csv(slugs)})", "select": "id,slug,website,sector"},
        )
        existing_by_slug = {row["slug"]: row for row in existing_companies}

    # Enrich all companies concurrently (a no-op for those without a website).
    with stage("enrich_companies"):
        websites = [(existing_by_slug.get(s) or {}).get("website") for s in slugs]
        enrichments = await asyncio.gather(
            *[enrich_company(client, website) for website in websites]
        )
        enrichment_by_slug = dict(zip(slugs, enrichments))

    # Build company rows (lead scoring is in-memory/cheap).
    with stage("score_and_build_companies"):
        company_rows: list[dict[str, Any]] = []
        for slug in slugs:
            group = groups[slug]
            group_jobs: list[NormalizedJob] = group["jobs"]
            prior = existing_by_slug.get(slug)
            enrichment = enrichment_by_slug.get(slug, {})
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
            if prior:
                stats.companies_updated += 1
            else:
                stats.companies_created += 1

    with stage("upsert_companies", f"({len(company_rows)} rows)"):
        upserted = await rest.upsert(
            client,
            "companies",
            company_rows,
            on_conflict="slug",
            prefer="resolution=merge-duplicates,return=representation",
        )
        company_id_by_slug = {row["slug"]: row["id"] for row in upserted}

    # Build normalized job rows, deduplicating within this crawl by content_hash.
    with stage("normalize_jobs"):
        unique_rows: list[dict[str, Any]] = []
        seen_hashes: set[str] = set()
        for slug in slugs:
            company_id = company_id_by_slug.get(slug)
            if not company_id:
                continue
            for job in groups[slug]["jobs"]:
                digest = content_hash(slug, job.title, job.city)
                if digest in seen_hashes:
                    stats.duplicate_jobs += 1
                    continue
                seen_hashes.add(digest)
                unique_rows.append(
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
        stats.normalized_jobs = len(unique_rows)

    # Which of the unique rows already exist (updated vs inserted)?
    with stage("select_existing_jobs", f"({len(unique_rows)} hashes)"):
        all_hashes = [row["content_hash"] for row in unique_rows]
        existing_hashes: set[str] = set()
        for chunk in _chunks(all_hashes, 100):
            rows = await rest.select(
                client,
                "jobs",
                {"content_hash": f"in.({_csv(chunk)})", "select": "content_hash"},
            )
            existing_hashes.update(row["content_hash"] for row in rows)
        stats.updated_jobs = sum(
            1 for row in unique_rows if row["content_hash"] in existing_hashes
        )
        stats.inserted_jobs = len(unique_rows) - stats.updated_jobs

    # Batch upsert (insert new + refresh existing) by content_hash.
    with stage("upsert_jobs", f"({len(unique_rows)} rows)"):
        for chunk in _chunks(unique_rows, 100):
            await rest.upsert(
                client,
                "jobs",
                chunk,
                on_conflict="content_hash",
                prefer="resolution=merge-duplicates,return=minimal",
            )


async def _execute(
    rest: SupabaseRest,
    settings: Any,
    query: str,
    city: str,
    sources: list[str],
    stats: CrawlStats,
    normalized_query: str,
    normalized_city: str,
) -> None:
    async with httpx.AsyncClient() as client:
        with stage("fetch_total"):
            jobs = await _fetch_all(client, settings, query, city, sources, stats)
        stats.raw_jobs = len(jobs)

        with stage("ingest_total", f"({len(jobs)} raw jobs)"):
            await _ingest(client, rest, jobs, stats)

        # Refresh the 24h cache marker.
        with stage("upsert_discovery_query"):
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


async def _finalize(
    rest: SupabaseRest,
    run_id: str,
    status: str,
    error_note: str | None,
    stats: CrawlStats,
) -> None:
    """Write the terminal state to crawl_runs. Never raises."""
    try:
        async with httpx.AsyncClient() as client:
            with stage("update_crawl_run"):
                await rest.update(
                    client,
                    "crawl_runs",
                    {"id": f"eq.{run_id}"},
                    {
                        "status": status,
                        "finished_at": _now_iso(),
                        "error": error_note,
                        **stats.as_columns(),
                    },
                )
    except Exception:  # noqa: BLE001 - swallow bookkeeping failures
        pass


async def run_crawl(run_id: str, query: str, city: str, sources: list[str]) -> None:
    """Background entrypoint. Always finalizes crawl_runs to completed/failed."""
    settings = get_settings()
    rest = SupabaseRest(settings.supabase_url, settings.supabase_service_role_key)
    stats = CrawlStats()

    normalized_query = normalize_query(query)
    normalized_city = normalize_query(city)

    status = "completed"
    error_note: str | None = None
    started = time.perf_counter()

    try:
        await asyncio.wait_for(
            _execute(
                rest,
                settings,
                query,
                city,
                sources,
                stats,
                normalized_query,
                normalized_city,
            ),
            timeout=OVERALL_TIMEOUT_SECONDS,
        )
        if stats.source_errors:
            error_note = "; ".join(
                f"{source}: {message}"
                for source, message in stats.source_errors.items()
            )
    except asyncio.TimeoutError:
        status = "failed"
        error_note = "Crawl timed out."
    except Exception as exc:  # noqa: BLE001 - record failure, never raise
        status = "failed"
        error_note = _safe_error(exc)

    await _finalize(rest, run_id, status, error_note, stats)
    log_stage("crawl_total", time.perf_counter() - started, f"[{status}]")
