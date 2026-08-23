"""Orchestration: company → candidate search → resolution → stored link."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from app.crawler.supabase_rest import SupabaseRest
from app.sponsors.candidates import CandidateSearch
from app.sponsors.resolver import Resolution, resolve

logger = logging.getLogger("careerhub.sponsors.service")

COMPANY_COLUMNS = "id,name,slug,website,sector,region,hq_location"
LINK_TABLE = "company_sponsorship"
CHECK_TABLE = "company_sponsorship_checks"
IMPORTS_TABLE = "sponsor_register_imports"


async def latest_register_import_id(
    client: httpx.AsyncClient, rest: SupabaseRest
) -> Optional[str]:
    """The id of the most recent successful register import, if any.

    A company's conclusion is pinned to the edition it was drawn against, so a
    newer edition is what makes that conclusion stale.
    """
    rows = await rest.select(
        client,
        IMPORTS_TABLE,
        {
            "select": "id",
            "status": "eq.success",
            "order": "started_at.desc",
            "limit": "1",
        },
    )
    return str(rows[0]["id"]) if rows else None


async def record_check(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    company_id: str,
    *,
    decision: str,
    candidate_count: int,
    matched_licence_id: Optional[str] = None,
    register_import_id: Optional[str] = None,
    attempts: int = 1,
    error: Optional[str] = None,
) -> None:
    """Record what the last attempt concluded for this company.

    Upserted on `company_id`, so repeating a resolution overwrites the state
    rather than accumulating rows.
    """
    now = datetime.now(timezone.utc).isoformat()
    await rest.upsert(
        client,
        CHECK_TABLE,
        [
            {
                "company_id": company_id,
                "last_decision": decision,
                "candidate_count": candidate_count,
                "matched_licence_id": matched_licence_id,
                "register_import_id": register_import_id,
                "attempts": attempts,
                "error": error,
                "checked_at": now,
                "updated_at": now,
            }
        ],
        on_conflict="company_id",
        prefer="resolution=merge-duplicates,return=minimal",
    )


async def companies_needing_resolution(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    company_ids: Optional[list[str]] = None,
    *,
    limit: int = 200,
) -> list[str]:
    """Company ids whose sponsorship conclusion is missing or stale.

    A company needs resolving when it has never been checked, when its last
    attempt errored, or when it was checked against an older register edition
    than the current one. Everything else is skipped — that is what keeps a
    crawl from re-resolving the same companies every run.
    """
    current_import = await latest_register_import_id(client, rest)

    if company_ids is not None:
        if not company_ids:
            return []
        checks = await _checks_for(client, rest, company_ids)
        pool = list(company_ids)
    else:
        rows = await rest.select(
            client,
            "companies",
            {"select": "id", "order": "created_at.desc", "limit": str(limit * 4)},
        )
        pool = [str(row["id"]) for row in rows]
        checks = await _checks_for(client, rest, pool) if pool else {}

    stale: list[str] = []
    for company_id in pool:
        check = checks.get(str(company_id))
        if check is None:
            stale.append(str(company_id))
        elif check.get("last_decision") == "error":
            stale.append(str(company_id))
        elif current_import and str(check.get("register_import_id") or "") != current_import:
            stale.append(str(company_id))
        if len(stale) >= limit:
            break
    return stale


async def _checks_for(
    client: httpx.AsyncClient, rest: SupabaseRest, company_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Existing check rows for these companies, keyed by company id."""
    found: dict[str, dict[str, Any]] = {}
    for index in range(0, len(company_ids), 100):
        chunk = company_ids[index : index + 100]
        rows = await rest.select(
            client,
            CHECK_TABLE,
            {
                "select": "company_id,last_decision,register_import_id,checked_at",
                "company_id": f"in.({','.join(chunk)})",
            },
        )
        for row in rows:
            found[str(row["company_id"])] = row
    return found


async def load_company(
    client: httpx.AsyncClient, rest: SupabaseRest, company_id: str
) -> Optional[dict[str, Any]]:
    rows = await rest.select(
        client,
        "companies",
        {"id": f"eq.{company_id}", "select": COMPANY_COLUMNS, "limit": "1"},
    )
    return rows[0] if rows else None


async def store_resolution(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    resolution: Resolution,
    model: str,
) -> None:
    """Persist the resolution.

    Only a `match` carries a licence id, so only a match can ever be read as a
    sponsorship link. An `ambiguous` result has no candidate to key on, so there
    is nothing to store — it is logged for review instead of being written as a
    half-link that a later reader might mistake for a match.
    """
    if resolution.decision != "match" or not resolution.selected_candidate_id:
        logger.info(
            "No link stored for company %s (decision=%s, confidence=%.2f)",
            resolution.company_id, resolution.decision, resolution.confidence,
        )
        return

    await rest.upsert(
        client,
        LINK_TABLE,
        [
            {
                "company_id": resolution.company_id,
                "sponsor_licence_id": resolution.selected_candidate_id,
                "decision": resolution.decision,
                "confidence": round(resolution.confidence, 2),
                "matched_on": resolution.matched_on,
                "reasoning": resolution.reasoning,
                "resolved_by": "claude",
                "model": model,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ],
        on_conflict="company_id,sponsor_licence_id",
        prefer="resolution=merge-duplicates,return=minimal",
    )
    logger.info(
        "Linked company %s to licence %s (confidence %.2f)",
        resolution.company_id,
        resolution.selected_candidate_id,
        resolution.confidence,
    )


async def resolve_company(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    company_id: str,
    *,
    api_key: str,
    model: str,
    timeout: float = 30.0,
    anthropic_client: Any = None,
    persist: bool = True,
) -> tuple[Optional[Resolution], list[dict[str, Any]], list[str]]:
    """Resolve one company end to end.

    Returns `(resolution, candidates, strategies)`; the resolution is None when
    the company id does not exist.
    """
    company = await load_company(client, rest, company_id)
    if company is None:
        return None, [], []

    candidates, strategies = await CandidateSearch(rest).find(
        client, name=company.get("name") or "", city=company.get("hq_location")
        or company.get("region"),
    )

    resolution = resolve(
        company,
        candidates,
        api_key=api_key,
        model=model,
        timeout=timeout,
        client=anthropic_client,
    )

    if persist:
        await store_resolution(client, rest, resolution, model)

    return resolution, candidates, strategies
