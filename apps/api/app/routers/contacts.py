"""Coach-facing company contacts: CRUD, authenticated, service-role-mediated.

Contacts are shared crawler-adjacent data, like companies/jobs — not
per-coach data like outreach drafts — so any authenticated coach may view,
add, edit or delete any company's contacts, exactly as any coach may edit a
company. See migration 0011 for why this table is RLS-denied and reachable
only through this router (never direct from the browser, and never on a
public/student-facing page): `get_current_user` — "the request carries a
valid Supabase session" — is this project's only coach gate, the same as
every other route in this codebase.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.crawler.supabase_rest import SupabaseRest
from app.schemas import Contact, ContactCreate, ContactWrite

router = APIRouter(prefix="/contacts", tags=["contacts"])

logger = logging.getLogger(__name__)

CONTACT_COLUMNS = (
    "id,company_id,full_name,job_title,email,phone,linkedin_url,notes,"
    "created_at,updated_at"
)


def _require_supabase(settings: Settings) -> SupabaseRest:
    if not (settings.supabase_url and settings.supabase_service_role_key):
        raise HTTPException(
            status_code=500, detail="Server is not configured for Supabase access."
        )
    return SupabaseRest(settings.supabase_url, settings.supabase_service_role_key)


async def _company_exists(
    client: httpx.AsyncClient, rest: SupabaseRest, company_id: str
) -> bool:
    rows = await rest.select(
        client, "companies", {"id": f"eq.{company_id}", "select": "id", "limit": "1"}
    )
    return bool(rows)


@router.get("", response_model=list[Contact])
async def list_contacts(
    company_id: str = Query(..., description="Company to list contacts for."),
    _user_id: str = Depends(get_current_user),
) -> list[Contact]:
    """Every contact for one company, most recently added first."""
    settings = get_settings()
    rest = _require_supabase(settings)

    async with httpx.AsyncClient() as client:
        rows = await rest.select(
            client,
            "contacts",
            {
                "company_id": f"eq.{company_id}",
                "select": CONTACT_COLUMNS,
                "order": "created_at.desc",
            },
        )

    return [Contact(**row) for row in rows]


@router.post("", response_model=Contact, status_code=201)
async def create_contact(
    body: ContactCreate,
    _user_id: str = Depends(get_current_user),
) -> Contact:
    settings = get_settings()
    rest = _require_supabase(settings)
    company_id = str(body.company_id)

    async with httpx.AsyncClient() as client:
        if not await _company_exists(client, rest, company_id):
            raise HTTPException(status_code=404, detail="Company not found.")

        row = {
            "company_id": company_id,
            "full_name": body.full_name,
            "job_title": body.job_title,
            "email": body.email,
            "phone": body.phone,
            "linkedin_url": body.linkedin_url,
            "notes": body.notes,
        }
        try:
            created = await rest.insert(client, "contacts", [row])
        except httpx.HTTPStatusError as exc:
            if "contacts_has_contact_method" in exc.response.text:
                raise HTTPException(
                    status_code=422,
                    detail="A contact needs at least one contact method: "
                    "email, phone, or LinkedIn.",
                ) from exc
            logger.exception("Creating contact for company %s failed", company_id)
            raise HTTPException(
                status_code=502, detail="The contact could not be created."
            ) from exc

    return Contact(**created[0])


@router.put("/{contact_id}", response_model=Contact)
async def update_contact(
    contact_id: str,
    body: ContactWrite,
    _user_id: str = Depends(get_current_user),
) -> Contact:
    """Replace a contact's editable fields. Full-form submit, not a sparse
    PATCH — see `ContactWrite`."""
    settings = get_settings()
    rest = _require_supabase(settings)

    values = {
        "full_name": body.full_name,
        "job_title": body.job_title,
        "email": body.email,
        "phone": body.phone,
        "linkedin_url": body.linkedin_url,
        "notes": body.notes,
    }

    async with httpx.AsyncClient() as client:
        try:
            updated = await rest.update(
                client,
                "contacts",
                {"id": f"eq.{contact_id}"},
                values,
                prefer="return=representation",
            )
        except httpx.HTTPStatusError as exc:
            if "contacts_has_contact_method" in exc.response.text:
                raise HTTPException(
                    status_code=422,
                    detail="A contact needs at least one contact method: "
                    "email, phone, or LinkedIn.",
                ) from exc
            logger.exception("Updating contact %s failed", contact_id)
            raise HTTPException(
                status_code=502, detail="The contact could not be updated."
            ) from exc

    if not updated:
        raise HTTPException(status_code=404, detail="Contact not found.")

    return Contact(**updated[0])


@router.delete("/{contact_id}", status_code=204)
async def delete_contact(
    contact_id: str,
    _user_id: str = Depends(get_current_user),
) -> None:
    settings = get_settings()
    rest = _require_supabase(settings)

    async with httpx.AsyncClient() as client:
        deleted = await rest.delete(client, "contacts", {"id": f"eq.{contact_id}"})

    if not deleted:
        raise HTTPException(status_code=404, detail="Contact not found.")
