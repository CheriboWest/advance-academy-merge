"""Permanent company deletion.

Deleting a company removes shared crawler data for *everyone* — every coach,
every student, the public search and the company detail page — so the write is
kept off the browser entirely. The flow is:

    coach's browser
      → Next.js server action (coach's Supabase session, anon key)
        → this endpoint (verifies the coach's JWT)
          → Postgres RPC `delete_companies_permanently` (service role key)

The service role key lives only in this process's environment, and the RPC is
granted to `service_role` alone, so neither the browser nor a coach's
`authenticated` session can reach the destructive path directly.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import get_settings
from app.schemas import DeleteCompaniesRequest, DeleteCompaniesResponse

router = APIRouter(prefix="/companies", tags=["companies"])

logger = logging.getLogger(__name__)

RPC_NAME = "delete_companies_permanently"


@router.post("/delete", response_model=DeleteCompaniesResponse)
async def delete_companies(
    req: DeleteCompaniesRequest,
    user_id: str = Depends(get_current_user),
) -> DeleteCompaniesResponse:
    """Permanently delete companies and their dependent rows, for all users.

    Any authenticated coach may delete: companies are shared crawler data with
    no per-coach ownership, exactly as any coach may create them by running the
    crawler. The RPC performs the whole deletion in one transaction, so the
    result is all-or-nothing rather than a half-deleted company.
    """
    settings = get_settings()

    if not (settings.supabase_url and settings.supabase_service_role_key):
        raise HTTPException(
            status_code=500, detail="Server is not configured for Supabase access."
        )

    # Pydantic parsed these as UUIDs; de-duplicate before the round trip. The
    # RPC de-duplicates too — this only keeps the request small.
    company_ids = list(dict.fromkeys(str(cid) for cid in req.company_ids))

    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/{RPC_NAME}"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }

    logger.info(
        "Coach %s requested permanent deletion of %d company/companies",
        user_id,
        len(company_ids),
    )

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                url, headers=headers, json={"p_company_ids": company_ids}
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            body = exc.response.text
            logger.error(
                "Permanent deletion failed (%s): %s", exc.response.status_code, body
            )
            # The function is missing until migration 0004 is applied; say so
            # plainly rather than reporting a generic upstream failure.
            if "PGRST202" in body or "Could not find the function" in body:
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "The deletion function is not installed on the database. "
                        "Apply migration 0004_company_permanent_delete.sql."
                    ),
                ) from exc
            raise HTTPException(
                status_code=502,
                detail="The companies could not be deleted. Nothing was changed.",
            ) from exc
        except httpx.HTTPError as exc:
            logger.exception("Permanent deletion could not reach Supabase")
            raise HTTPException(
                status_code=502,
                detail="The companies could not be deleted. Nothing was changed.",
            ) from exc

    payload = response.json()
    # PostgREST returns a scalar-returning function's value directly, but a
    # single-element list is possible depending on the Accept header.
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    if not isinstance(payload, dict):
        logger.error("Unexpected RPC payload for %s: %r", RPC_NAME, payload)
        raise HTTPException(
            status_code=502, detail="The database returned an unexpected response."
        )

    result = DeleteCompaniesResponse(**payload)
    logger.info(
        "Coach %s permanently deleted %d/%d companies (%d jobs, %d coach meta rows, "
        "%d outreach emails unlinked)",
        user_id,
        result.deleted_companies,
        result.requested,
        result.deleted_jobs,
        result.deleted_coach_meta,
        result.unlinked_outreach_emails,
    )
    return result
