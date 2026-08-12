"""AI outreach generation endpoint, powered by Anthropic Claude Sonnet."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.schemas import OutreachRequest, OutreachResponse

router = APIRouter(prefix="/ai", tags=["ai"])

SYSTEM_PROMPT = (
    "You write outreach emails for a UK recruitment and coaching business that "
    "helps students and candidates connect with hiring companies.\n\n"
    "Write each email in professional British English. Keep it concise. "
    "Personalise it to the specific company using the details provided, and "
    "mention their hiring activity naturally rather than mechanically. Avoid "
    "spammy or salesy language, exclamation marks, and empty superlatives. The "
    "body must be between 120 and 180 words, warm but businesslike, and suitable "
    "for reaching out to a hiring company. Do not invent facts that were not "
    "provided.\n\n"
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
    location = req.location or "an unspecified location"
    sector = req.sector or "an unspecified sector"
    return (
        "Write an outreach email to this company.\n\n"
        f"Company name: {req.company_name}\n"
        f"Location: {location}\n"
        f"Sector: {sector}\n"
        f"Open jobs: {req.open_jobs}\n"
        f"Lead score (0-100): {req.lead_score}\n"
    )


@router.post("/outreach", response_model=OutreachResponse)
def generate_outreach(req: OutreachRequest) -> OutreachResponse:
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
