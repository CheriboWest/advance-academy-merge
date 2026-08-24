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
LICENCES_TABLE = "sponsor_licences"


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
    attempts: int = 0,
    error: Optional[str] = None,
) -> None:
    """Record what the last attempt concluded for this company.

    `attempts` is the CUMULATIVE COUNT OF FAILED MODEL HTTP ATTEMPTS for this
    company against `register_import_id`, since its last successful conclusion —
    not resolution runs, and not successful calls. Three transient failures in
    one run advance it by 3. A run that reaches any conclusion (match,
    ambiguous or no_match) resets it to 0, because the company is no longer
    failing. The caller owns that arithmetic; this function just stores it.

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


# A company that keeps failing must stop costing model calls. Nine cumulative
# failed attempts against one register edition — three runs at the per-run limit
# — is where automatic retrying stops and manual review takes over.
MAX_CUMULATIVE_ATTEMPTS = 9


async def companies_needing_resolution(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    company_ids: Optional[list[str]] = None,
    *,
    limit: int = 200,
    current_import: Optional[str] = None,
) -> list[str]:
    """Company ids whose sponsorship conclusion is missing or stale.

    A company needs resolving when it has never been checked, when it was
    checked against an older register edition, or when its last attempt errored
    AND it has not yet exhausted its retry budget. Everything else is skipped —
    that is what keeps a crawl from re-resolving the same companies every run,
    and what stops a permanently failing company from burning model calls
    forever.

    A newer register edition reopens everything, exhausted budget included: the
    candidate data has changed, so the previous failure says nothing about the
    new question.
    """
    if current_import is None:
        current_import = await latest_register_import_id(client, rest)

    if company_ids is not None:
        if not company_ids:
            return []
        checks = await checks_for(client, rest, company_ids)
        pool = list(company_ids)
    else:
        rows = await rest.select(
            client,
            "companies",
            {"select": "id", "order": "created_at.desc", "limit": str(limit * 4)},
        )
        pool = [str(row["id"]) for row in rows]
        checks = await checks_for(client, rest, pool) if pool else {}

    stale: list[str] = []
    for company_id in pool:
        check = checks.get(str(company_id))
        same_edition = (
            check is not None
            and current_import is not None
            and str(check.get("register_import_id") or "") == current_import
        )

        if check is None:
            stale.append(str(company_id))
        elif current_import is not None and not same_edition:
            # A newer edition reopens the question regardless of past failures.
            stale.append(str(company_id))
        elif check.get("last_decision") == "error":
            attempts = int(check.get("attempts") or 0)
            if attempts < MAX_CUMULATIVE_ATTEMPTS:
                stale.append(str(company_id))
            else:
                logger.info(
                    "company_id=%s left for manual review: %d cumulative failed "
                    "attempts against the current register edition (cap %d). "
                    "Use force to retry.",
                    company_id, attempts, MAX_CUMULATIVE_ATTEMPTS,
                )
        if len(stale) >= limit:
            break
    return stale


async def checks_for(
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
                "select": (
                    "company_id,last_decision,register_import_id,attempts,"
                    "checked_at,candidate_count"
                ),
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


async def _current_match(
    client: httpx.AsyncClient, rest: SupabaseRest, company_id: str
) -> Optional[dict[str, Any]]:
    """The confirmed, currently-live sponsor match for a company, or None.

    Reads `company_sponsorship` directly rather than the
    `company_sponsorship_current` view: the view gives everything the response
    needs about the matched row EXCEPT `normalized_name`/`normalized_town`,
    which grouping sibling routes needs, so this queries `sponsor_licences`
    itself for both the matched row's display fields and its grouping key in
    one place.

    `None` when there is no `match` link, or when the matched licence has
    stopped being current — the latter cannot happen for a check run against
    today's edition (identity is confirmed at the moment the row was live), but
    is handled rather than assumed, since it costs nothing to check.
    """
    links = await rest.select(
        client,
        LINK_TABLE,
        {
            "select": "sponsor_licence_id,confidence,resolved_at",
            "company_id": f"eq.{company_id}",
            "decision": "eq.match",
            "limit": "1",
        },
    )
    if not links:
        return None
    link = links[0]

    licences = await rest.select(
        client,
        LICENCES_TABLE,
        {
            "select": (
                "organisation_name,town_city,county,type_rating,licence_type,"
                "rating,route,normalized_name,normalized_town,is_current"
            ),
            "id": f"eq.{link['sponsor_licence_id']}",
            "limit": "1",
        },
    )
    if not licences or not licences[0].get("is_current"):
        return None
    licence = licences[0]

    # Sibling routes for the same organisation at the same registered site —
    # the register carries no organisation-level id, so (normalized_name,
    # normalized_town) is the closest safe grouping key, and it is the same
    # key the candidate matcher itself uses for exact identity lookup.
    town = licence.get("normalized_town")
    sibling_filter = {
        "select": "route",
        "is_current": "eq.true",
        "normalized_name": f"eq.{licence['normalized_name']}",
    }
    sibling_filter["normalized_town"] = (
        f"eq.{town}" if town else "is.null"
    )
    siblings = await rest.select(client, LICENCES_TABLE, sibling_filter)
    routes = sorted({s["route"] for s in siblings if s.get("route")})
    if licence.get("route") and licence["route"] not in routes:
        routes.append(licence["route"])
        routes.sort()

    return {
        "organisation_name": licence["organisation_name"],
        "town_city": licence.get("town_city"),
        "county": licence.get("county"),
        "type_rating": licence.get("type_rating"),
        "licence_type": licence.get("licence_type"),
        "rating": licence.get("rating"),
        "routes": routes,
        "confidence": float(link.get("confidence") or 0.0),
        "resolved_at": link.get("resolved_at"),
    }


async def company_sponsorship_status(
    client: httpx.AsyncClient, rest: SupabaseRest, company_id: str
) -> dict[str, Any]:
    """The coach-facing sponsorship status for one company.

    See `CompanySponsorshipStatus` (app/schemas.py) for the field-by-field
    contract, in particular why `licensed` needs no staleness check while the
    other four states do.
    """
    latest_import = await latest_register_import_id(client, rest)

    match = await _current_match(client, rest, company_id)
    if match is not None:
        checks = await checks_for(client, rest, [company_id])
        check = checks.get(str(company_id))
        return {
            "company_id": company_id,
            "status": "licensed",
            "checked_at": (check or {}).get("checked_at") or match["resolved_at"],
            "register_import_id": latest_import,
            "candidate_count": (check or {}).get("candidate_count"),
            "stale": False,
            "match": {k: v for k, v in match.items() if k != "resolved_at"},
        }

    checks = await checks_for(client, rest, [company_id])
    check = checks.get(str(company_id))

    if check is None:
        return {
            "company_id": company_id,
            "status": "not_checked",
            "checked_at": None,
            "register_import_id": latest_import,
            "candidate_count": None,
            "stale": False,
            "match": None,
        }

    check_import = check.get("register_import_id")
    is_stale = (
        latest_import is not None
        and str(check_import or "") != latest_import
    )
    if is_stale:
        return {
            "company_id": company_id,
            "status": "not_checked",
            "checked_at": check.get("checked_at"),
            "register_import_id": latest_import,
            "candidate_count": check.get("candidate_count"),
            "stale": True,
            "match": None,
        }

    decision = check.get("last_decision")
    status_value = decision if decision in ("ambiguous", "no_match", "error") else "not_checked"
    return {
        "company_id": company_id,
        "status": status_value,
        "checked_at": check.get("checked_at"),
        "register_import_id": latest_import,
        "candidate_count": check.get("candidate_count"),
        "stale": False,
        "match": None,
    }


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
