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
