"""Sponsor-register ingestion and entity-resolution endpoints.

Both are coach-authenticated and run server-side with the service role key: the
register is shared reference data, and the browser has no business writing it.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.crawler.supabase_rest import SupabaseRest
from app.schemas import (
    CompanySponsorshipStatus,
    SponsorImportResponse,
    SponsorResolutionResponse,
)
from app.sponsors import govuk
from app.sponsors.importer import run_import
from app.sponsors.service import company_sponsorship_status, load_company, resolve_company
from app.sponsors.worker import resolve_companies

router = APIRouter(prefix="/sponsors", tags=["sponsors"])

logger = logging.getLogger(__name__)


def _require_supabase(settings: Settings) -> SupabaseRest:
    if not (settings.supabase_url and settings.supabase_service_role_key):
        raise HTTPException(
            status_code=500, detail="Server is not configured for Supabase access."
        )
    return SupabaseRest(settings.supabase_url, settings.supabase_service_role_key)


@router.post("/import", response_model=SponsorImportResponse)
async def import_register(
    _user_id: str = Depends(get_current_user),
) -> SponsorImportResponse:
    """Download the current GOV.UK register and ingest it.

    Safe to run repeatedly and the way to pick up a new edition: GOV.UK's
    publication page is read each time, so a newly published CSV is found
    without a code change. Re-running against an unchanged file reports every
    row as unchanged.
    """
    settings = get_settings()
    rest = _require_supabase(settings)

    try:
        run_id, stats = await run_import(rest)
    except govuk.RegisterUnavailableError as exc:
        logger.error("Register unavailable: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=f"Could not obtain the register from GOV.UK: {exc}",
        ) from exc
    except httpx.HTTPError as exc:
        logger.exception("Register import failed")
        raise HTTPException(
            status_code=502, detail="The register import failed."
        ) from exc

    return SponsorImportResponse(
        import_id=run_id or None, status="success", **stats.as_columns()
    )


@router.get("/imports", response_model=list[dict])
async def import_history(
    limit: int = Query(10, ge=1, le=50),
    _user_id: str = Depends(get_current_user),
) -> list[dict]:
    """Recent ingestion runs, newest first — the audit trail for the register."""
    settings = get_settings()
    rest = _require_supabase(settings)

    async with httpx.AsyncClient() as client:
        return await rest.select(
            client,
            "sponsor_register_imports",
            {"select": "*", "order": "started_at.desc", "limit": str(limit)},
        )


@router.post("/resolve/{company_id}", response_model=SponsorResolutionResponse)
async def resolve_sponsorship(
    company_id: str,
    persist: bool = Query(True, description="Store a confirmed match."),
    _user_id: str = Depends(get_current_user),
) -> SponsorResolutionResponse:
    """Resolve one company against the register.

    The database narrows the register to a handful of candidates before Claude
    sees anything, and only a confident match is stored. `no_match` and
    `ambiguous` deliberately create no sponsorship link.
    """
    settings = get_settings()
    rest = _require_supabase(settings)

    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=500,
            detail="Server is not configured with an Anthropic API key.",
        )

    async with httpx.AsyncClient() as client:
        resolution, candidates, strategies = await resolve_company(
            client,
            rest,
            company_id,
            api_key=settings.anthropic_api_key,
            model=settings.sponsor_resolver_model,
            timeout=settings.request_timeout,
            persist=persist,
        )

    if resolution is None:
        raise HTTPException(status_code=404, detail="Company not found.")

    return SponsorResolutionResponse(
        **resolution.as_dict(),
        candidates_considered=len(candidates),
        search_strategies=strategies,
        persisted=persist and resolution.decision == "match",
    )


@router.post("/resolve", response_model=dict)
async def bulk_resolve(
    limit: int = Query(50, ge=1, le=500, description="Maximum companies to resolve."),
    force: bool = Query(False, description="Re-resolve even if already current."),
    _user_id: str = Depends(get_current_user),
) -> dict:
    """Resolve companies whose sponsorship conclusion is missing or stale.

    The backfill for companies crawled before sponsorship existed, and the way
    to sweep every company after a register refresh — a newer edition makes
    earlier conclusions stale, so they become eligible again automatically.

    Bounded by `limit` and by the configured concurrency, and never raises: a
    per-company failure is counted and reported rather than aborting the batch.
    """
    settings = get_settings()
    rest = _require_supabase(settings)

    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=500,
            detail="Server is not configured with an Anthropic API key.",
        )

    async with httpx.AsyncClient() as client:
        stats = await resolve_companies(
            client,
            rest,
            None,
            api_key=settings.anthropic_api_key,
            model=settings.sponsor_resolver_model,
            timeout=settings.request_timeout,
            concurrency=settings.sponsor_resolve_concurrency,
            max_companies=limit,
            force=force,
        )

    return {"status": "completed", **stats.as_dict(), "errors": stats.errors[:10]}


@router.get("/companies/{company_id}", response_model=CompanySponsorshipStatus)
async def get_company_sponsorship_status(
    company_id: str,
    _user_id: str = Depends(get_current_user),
) -> CompanySponsorshipStatus:
    """This company's coach-facing sponsorship status.

    One of five normalized states — licensed | ambiguous | no_match | error |
    not_checked — never the raw register/check rows. Coach-authenticated the
    same way every other route on this router is: this project has no separate
    coach/student role anywhere (no JWT claim, no profiles table), so
    `get_current_user` — "the request carries a valid Supabase session" — IS
    the coach gate, exactly as it already is for /sponsors/import,
    /sponsors/resolve and every route in companies.py/ai.py/email.py. The
    sponsorship tables stay service-role-only; nothing here is queried by the
    browser directly.

    See `CompanySponsorshipStatus` for exactly what each field means and why
    `licensed` and the other four states are trusted for freshness differently.
    """
    settings = get_settings()
    rest = _require_supabase(settings)

    async with httpx.AsyncClient() as client:
        if await load_company(client, rest, company_id) is None:
            raise HTTPException(status_code=404, detail="Company not found.")
        status = await company_sponsorship_status(client, rest, company_id)

    return CompanySponsorshipStatus(**status)


@router.post("/companies/{company_id}/recheck", response_model=CompanySponsorshipStatus)
async def recheck_company_sponsorship(
    company_id: str,
    _user_id: str = Depends(get_current_user),
) -> CompanySponsorshipStatus:
    """Force a fresh sponsorship check for one company, then return its status.

    Reuses the batch worker (`resolve_companies`, force=True, one company) —
    NOT `service.resolve_company` — because the worker is the only path that
    writes `company_sponsorship_checks` as well as `company_sponsorship`;
    calling the one-shot resolver directly would leave the check row stale for
    an ambiguous/no_match outcome. No matching logic is duplicated here.
    """
    settings = get_settings()
    rest = _require_supabase(settings)

    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=500,
            detail="Server is not configured with an Anthropic API key.",
        )

    async with httpx.AsyncClient() as client:
        if await load_company(client, rest, company_id) is None:
            raise HTTPException(status_code=404, detail="Company not found.")

        batch = await resolve_companies(
            client,
            rest,
            [company_id],
            api_key=settings.anthropic_api_key,
            model=settings.sponsor_resolver_model,
            timeout=settings.request_timeout,
            concurrency=1,
            max_companies=1,
            force=True,
        )
        if batch.skipped_reason:
            raise HTTPException(
                status_code=409,
                detail="No sponsor register has been imported yet.",
            )
        status = await company_sponsorship_status(client, rest, company_id)

    return CompanySponsorshipStatus(**status)
