"""AI outreach generation endpoint, powered by Anthropic Claude Sonnet."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import get_settings
from app.schemas import OutreachRequest, OutreachResponse

router = APIRouter(prefix="/ai", tags=["ai"])

SYSTEM_PROMPT = (
    "You write outreach emails for a UK recruitment and coaching business that "
    "helps students and candidates connect with hiring companies.\n\n"
    "Write each email in professional British English. Keep it concise. "
    "Personalise it to the specific company using the details provided, and "
    "mention their hiring activity naturally rather than mechanically. If a "
    "recipient name is given, address them by first name and write to them as "
    "an individual, not 'the team'; if their role is also given, you may "
    "reference it naturally (e.g. why this matters for someone in that role). "
    "If open roles are listed by title, refer to one or two of them "
    "specifically rather than only citing a count. If a coach's private notes "
    "are provided, treat them as background context to inform tone and "
    "relevance — never quote them verbatim or reveal that notes exist. Avoid "
    "spammy or salesy language, exclamation marks, and empty superlatives. The "
    "body must be between 120 and 180 words, warm but businesslike, and suitable "
    "for reaching out to a hiring company. Do not invent facts that were not "
    "provided — in particular, only mention visa/sponsor licence status if it "
    "is explicitly given.\n\n"
    "Return only the subject line and the email body."
)

# Structured-output schema so the model reliably returns { subject, body }.
OUTREACH_SCHEMA = {
    "type": "object",
    "properties": {
        "subject": {"type": "string"},
        "body": {"type": "string"},
    },
    "required": ["subject", "body"],
    "additionalProperties": False,
}


def _build_user_prompt(req: OutreachRequest) -> str:
    """Structured context, one fact per line — only what `req` actually
    provides. Optional sections are omitted rather than filled with a
    placeholder like "not provided", so the model never has to be told to
    ignore a blank; there is simply nothing there to reason about.
    """
    location = req.location or "an unspecified location"
    sector = req.sector or "an unspecified sector"

    lines = [
        "Write an outreach email to this company.\n",
        f"Company name: {req.company_name}",
        f"Location: {location}",
        f"Sector: {sector}",
        f"Open jobs: {req.open_jobs}",
        f"Lead score (0-100): {req.lead_score}",
    ]

    if req.open_job_titles:
        lines.append("Open role titles: " + "; ".join(req.open_job_titles))

    if req.contact_name:
        lines.append(f"\nRecipient name: {req.contact_name}")
        if req.contact_role:
            lines.append(f"Recipient role: {req.contact_role}")

    # Sponsorship is deliberately included only for "licensed" — every other
    # status (ambiguous/no_match/not_checked/error) is either unconfirmed or
    # a non-match, and the system prompt already says only to mention
    # sponsorship if it is explicitly given here; omitting it for those
    # statuses is what makes that instruction actually safe to follow.
    if req.sponsorship_status == "licensed":
        lines.append(
            "\nSponsorship: this company holds a UK sponsor licence"
            + (
                f" (registered as {req.sponsorship_organisation_name})"
                if req.sponsorship_organisation_name
                else ""
            )
            + "."
        )

    if req.company_notes:
        lines.append(f"\nCoach's private notes about this company: {req.company_notes}")
    if req.contact_notes:
        lines.append(f"Coach's private notes about this contact: {req.contact_notes}")

    return "\n".join(lines) + "\n"


@router.post("/outreach", response_model=OutreachResponse)
def generate_outreach(
    req: OutreachRequest,
    user_id: str = Depends(get_current_user),
) -> OutreachResponse:
    # `user_id` is the authenticated coach's Supabase user id; its presence means
    # the request carried a valid token (a missing/invalid one returns 401).
    settings = get_settings()

    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=500,
            detail="Server is not configured with an Anthropic API key.",
        )

    # Imported lazily so the module imports (and `compileall`) without the
    # dependency installed; it's only needed at request time.
    try:
        import anthropic
    except ImportError as exc:  # pragma: no cover - environment guard
        raise HTTPException(
            status_code=500,
            detail="The 'anthropic' package is not installed on the server.",
        ) from exc

    client = anthropic.Anthropic(
        api_key=settings.anthropic_api_key,
        timeout=settings.request_timeout,
        max_retries=1,
    )

    try:
        message = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": OUTREACH_SCHEMA},
            },
            messages=[{"role": "user", "content": _build_user_prompt(req)}],
        )
    except anthropic.APITimeoutError as exc:
        raise HTTPException(
            status_code=504, detail="The AI service timed out. Please try again."
        ) from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(
            status_code=502, detail="Could not reach the AI service."
        ) from exc
    except anthropic.RateLimitError as exc:
        raise HTTPException(
            status_code=429, detail="The AI service is rate limited. Please retry shortly."
        ) from exc
    except anthropic.APIStatusError as exc:
        raise HTTPException(
            status_code=502, detail=f"The AI service returned an error ({exc.status_code})."
        ) from exc

    if getattr(message, "stop_reason", None) == "refusal":
        raise HTTPException(
            status_code=422,
            detail="The AI declined to generate this outreach message.",
        )

    text = "".join(
        block.text
        for block in message.content
        if getattr(block, "type", None) == "text"
    ).strip()

    try:
        data = json.loads(text)
        return OutreachResponse(subject=data["subject"], body=data["body"])
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail="The AI service returned an unexpected response.",
        ) from exc
