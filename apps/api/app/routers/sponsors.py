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
from app.schemas import SponsorImportResponse, SponsorResolutionResponse
from app.sponsors import govuk
from app.sponsors.importer import run_import
from app.sponsors.service import resolve_company

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
