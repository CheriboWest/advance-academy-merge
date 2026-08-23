"""Batch sponsorship resolution: bounded, retried, and isolated per company.

Used by the post-crawl hook, the bulk backfill endpoint, and the CLI — one
implementation so all three behave identically.

Three properties matter more than throughput here:

  * **Isolation.** One company's failure must not stop the batch, and the batch
    must never propagate out to whatever called it. A crawl that ingested jobs
    correctly is a successful crawl even if every sponsorship lookup fails.
  * **Boundedness.** A crawl touching 50 companies must not open 50 concurrent
    model requests. A semaphore caps in-flight work; the model calls themselves
    are synchronous, so they run in worker threads rather than blocking the
    event loop.
  * **Restraint.** Companies with a current conclusion are not re-resolved.
    Resolution costs a model call, so the cheap staleness check comes first.
"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

from app.crawler.supabase_rest import SupabaseRest
from app.sponsors.candidates import CandidateSearch
from app.sponsors.resolver import Resolution, resolve
from app.sponsors.service import (
    companies_needing_resolution,
    latest_register_import_id,
    load_company,
    record_check,
    store_resolution,
)

logger = logging.getLogger("careerhub.sponsors.worker")

# In-flight model requests. Deliberately small: the register rarely changes, so
# resolution is a background concern that should never contend with the crawl.
DEFAULT_CONCURRENCY = 3
# Ceiling per invocation, so one enormous crawl cannot trigger an unbounded run.
DEFAULT_MAX_COMPANIES = 50
# Attempts per company, including the first.
MAX_ATTEMPTS = 3
BASE_BACKOFF_SECONDS = 1.0
MAX_BACKOFF_SECONDS = 20.0


@dataclass
class BatchStats:
    """Outcome of one batch, for logging and API responses."""

    considered: int = 0
    skipped_current: int = 0
    resolved: int = 0
    matched: int = 0
    ambiguous: int = 0
    no_match: int = 0
    failed: int = 0
    claude_calls: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "considered": self.considered,
            "skipped_current": self.skipped_current,
            "resolved": self.resolved,
            "matched": self.matched,
            "ambiguous": self.ambiguous,
            "no_match": self.no_match,
            "failed": self.failed,
            "claude_calls": self.claude_calls,
        }


def _is_transient(exc: Exception) -> bool:
    """Whether an exception is worth retrying.

    Timeouts, connection failures, rate limits and 5xx are transient. A 4xx
    (bad request, bad key) will fail identically however many times it is
    retried, so it is not retried at all.
    """
    name = type(exc).__name__
    if name in {"APITimeoutError", "APIConnectionError", "RateLimitError"}:
        return True
    if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError)):
        return True
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status is None:
        status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return status == 429 or status >= 500
    return False


async def _resolve_with_retry(
    company: dict[str, Any],
    candidates: list[dict[str, Any]],
    *,
    api_key: str,
    model: str,
    timeout: float,
    anthropic_client: Any,
    sleeper: Any = asyncio.sleep,
) -> tuple[Resolution, int]:
    """Resolve one company, retrying transient failures. Returns (result, attempts).

    The model call is synchronous, so it runs in a worker thread — a blocking
    call on the event loop would serialise the whole batch behind it.
    """
    last: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            resolution = await asyncio.to_thread(
                resolve,
                company,
                candidates,
                api_key=api_key,
                model=model,
                timeout=timeout,
                client=anthropic_client,
            )
            return resolution, attempt
        except Exception as exc:  # noqa: BLE001 — classified below
            last = exc
            if not _is_transient(exc) or attempt == MAX_ATTEMPTS:
                break
            delay = min(
                BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)), MAX_BACKOFF_SECONDS
            )
            # Jitter so a batch that hits a rate limit does not retry in lockstep.
            delay += random.uniform(0, delay / 2)
            logger.warning(
                "company_id=%s attempt=%d/%d transient failure (%s); retrying in %.1fs",
                company.get("id"), attempt, MAX_ATTEMPTS, type(exc).__name__, delay,
            )
            await sleeper(delay)

    assert last is not None
    raise last


async def _resolve_one(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    company_id: str,
    *,
    api_key: str,
    model: str,
    timeout: float,
    register_import_id: Optional[str],
    anthropic_client: Any,
    stats: BatchStats,
    sleeper: Any,
) -> None:
    """Resolve one company. Never raises — every outcome is recorded."""
    try:
        company = await load_company(client, rest, company_id)
        if company is None:
            logger.warning("company_id=%s no longer exists; skipping", company_id)
            return

        candidates, strategies = await CandidateSearch(rest).find(
            client,
            name=company.get("name") or "",
            city=company.get("hq_location") or company.get("region"),
        )

        if not candidates:
            # No register row to resolve against — Claude is not called at all.
            # Recorded so the next crawl does not ask the same question again.
            logger.info(
                "company_id=%s candidates=0 decision=no_match (model not called)",
                company_id,
            )
            await record_check(
                client, rest, company_id,
                decision="no_match", candidate_count=0,
                register_import_id=register_import_id,
            )
            stats.no_match += 1
            stats.resolved += 1
            return

        resolution, attempts = await _resolve_with_retry(
            company, candidates,
            api_key=api_key, model=model, timeout=timeout,
            anthropic_client=anthropic_client, sleeper=sleeper,
        )
        stats.claude_calls += attempts

        await store_resolution(client, rest, resolution, model)
        await record_check(
            client, rest, company_id,
            decision=resolution.decision,
            candidate_count=len(candidates),
            matched_licence_id=resolution.selected_candidate_id,
            register_import_id=register_import_id,
            attempts=attempts,
        )

        logger.info(
            "company_id=%s candidates=%d strategies=%s decision=%s confidence=%.2f",
            company_id, len(candidates), strategies,
            resolution.decision, resolution.confidence,
        )
        stats.resolved += 1
        if resolution.decision == "match":
            stats.matched += 1
        elif resolution.decision == "ambiguous":
            stats.ambiguous += 1
        else:
            stats.no_match += 1

    except Exception as exc:  # noqa: BLE001 — isolation is the point
        reason = f"{type(exc).__name__}: {exc}"
        logger.error(
            "company_id=%s sponsorship resolution failed: %s", company_id, reason
        )
        stats.failed += 1
        stats.errors.append(f"{company_id}: {reason}"[:300])
        # Recorded as 'error' so the company is retried next time rather than
        # looking permanently settled.
        try:
            await record_check(
                client, rest, company_id,
                decision="error", candidate_count=0,
                register_import_id=register_import_id,
                error=reason[:1000],
            )
        except Exception:  # noqa: BLE001 — a failed record must not raise either
            logger.exception("company_id=%s could not record the failure", company_id)


async def resolve_companies(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    company_ids: Optional[list[str]] = None,
    *,
    api_key: str,
    model: str,
    timeout: float = 30.0,
    concurrency: int = DEFAULT_CONCURRENCY,
    max_companies: int = DEFAULT_MAX_COMPANIES,
    force: bool = False,
    anthropic_client: Any = None,
    sleeper: Any = asyncio.sleep,
) -> BatchStats:
    """Resolve a batch of companies against the register.

    `company_ids=None` selects companies needing resolution across the table
    (the bulk backfill). `force=True` re-resolves regardless of existing state.
    Never raises: a batch reports failures in its stats.
    """
    stats = BatchStats()

    if force and company_ids:
        targets = company_ids[:max_companies]
        stats.considered = len(company_ids)
    else:
        requested = len(company_ids) if company_ids is not None else max_companies
        targets = await companies_needing_resolution(
            client, rest, company_ids, limit=max_companies
        )
        stats.considered = requested
        stats.skipped_current = max(0, requested - len(targets))

    if not targets:
        logger.info(
            "Sponsorship: nothing to resolve (%d considered, %d already current)",
            stats.considered, stats.skipped_current,
        )
        return stats

    register_import_id = await latest_register_import_id(client, rest)
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def guarded(company_id: str) -> None:
        async with semaphore:
            await _resolve_one(
                client, rest, company_id,
                api_key=api_key, model=model, timeout=timeout,
                register_import_id=register_import_id,
                anthropic_client=anthropic_client, stats=stats, sleeper=sleeper,
            )

    logger.info(
        "Sponsorship: resolving %d companies (concurrency=%d, register_import=%s)",
        len(targets), concurrency, register_import_id or "none",
    )
    await asyncio.gather(*(guarded(cid) for cid in targets))
    logger.info("Sponsorship batch finished: %s", stats.as_dict())
    return stats
