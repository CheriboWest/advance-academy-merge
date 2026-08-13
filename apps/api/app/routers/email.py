"""Outreach email sending via a shared Google Workspace mailbox (Gmail SMTP)."""

from __future__ import annotations

from datetime import datetime, timezone
from email.message import EmailMessage

import aiosmtplib
import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import get_settings
from app.schemas import SendEmailRequest, SendEmailResponse

router = APIRouter(prefix="/email", tags=["email"])


def _rest_base(supabase_url: str) -> str:
    return f"{supabase_url.rstrip('/')}/rest/v1/outreach_emails"


@router.post("/send", response_model=SendEmailResponse)
async def send_email(
    req: SendEmailRequest,
    user_id: str = Depends(get_current_user),
) -> SendEmailResponse:
    settings = get_settings()

    if not (settings.supabase_url and settings.supabase_service_role_key):
        raise HTTPException(
            status_code=500,
            detail="Server is not configured for Supabase access.",
        )
    if not (
        settings.smtp_host
        and settings.smtp_username
        and settings.smtp_password
        and settings.smtp_from
    ):
        raise HTTPException(
            status_code=500, detail="Server is not configured for email sending."
        )

    rest_base = _rest_base(settings.supabase_url)
    service_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 1. Load the draft with the service key (bypasses RLS server-side).
        try:
            load = await client.get(
                rest_base,
                params={"id": f"eq.{req.draft_id}", "select": "*"},
                headers=service_headers,
            )
            load.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502, detail="Could not load the draft."
            ) from exc

        rows = load.json()
        if not rows:
            raise HTTPException(status_code=404, detail="Draft not found.")

        draft = rows[0]

        # 2. Ensure the draft belongs to the authenticated coach.
        if str(draft.get("coach_user_id")) != user_id:
            raise HTTPException(
                status_code=403, detail="This draft does not belong to you."
            )

        subject = draft.get("subject") or ""
        body = draft.get("body") or ""

        # 3. Send the email via Gmail SMTP (STARTTLS on port 587).
        message = EmailMessage()
        message["From"] = settings.smtp_from
        message["To"] = req.to
        message["Subject"] = subject
        message.set_content(body)

        try:
            await aiosmtplib.send(
                message,
                hostname=settings.smtp_host,
                port=settings.smtp_port,
                username=settings.smtp_username,
                password=settings.smtp_password,
                start_tls=True,
                timeout=20.0,
            )
        except (aiosmtplib.SMTPException, OSError, TimeoutError) as exc:
            raise HTTPException(
                status_code=502, detail="Failed to send the email."
            ) from exc

        # 4. Mark the draft as sent.
        sent_at = datetime.now(timezone.utc).isoformat()
        try:
            update = await client.patch(
                rest_base,
                params={"id": f"eq.{req.draft_id}"},
                headers={**service_headers, "Prefer": "return=minimal"},
                json={
                    "status": "sent",
                    "sent_at": sent_at,
                    "recipient_email": req.to,
                },
            )
            update.raise_for_status()
        except httpx.HTTPError as exc:
            # The email was sent; surface the bookkeeping failure clearly.
            raise HTTPException(
                status_code=502,
                detail="Email sent, but the draft status could not be updated.",
            ) from exc

    return SendEmailResponse(status="sent", sent_at=sent_at, recipient_email=req.to)
