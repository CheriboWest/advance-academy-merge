"""Claude entity resolution between a crawled company and register candidates.

Claude decides only ONE thing: whether the crawled company and a supplied
register row describe the same organisation. It is never asked, and is never
able to answer, whether a company holds a sponsor licence — that comes from the
register row it selects. A resolution with no candidates is `no_match` without a
model call at all.

Guardrails that live in code rather than in the prompt, because a prompt cannot
enforce them:

  * only ids from the supplied candidate list are accepted;
  * `ambiguous` never becomes a match, whatever confidence is returned;
  * a `match` below MIN_MATCH_CONFIDENCE is downgraded to `ambiguous`;
  * a `match` with no selected candidate is downgraded to `ambiguous`.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("careerhub.sponsors.resolver")

# Below this, a claimed match is recorded for review instead of being trusted.
MIN_MATCH_CONFIDENCE = 0.75

SYSTEM_PROMPT = (
    "You are an entity-resolution engine for a UK employment intelligence "
    "system.\n\n"
    "You decide whether a crawled company is the same legal or operating entity "
    "as one of the candidate organisations supplied from the official UK "
    "Register of Licensed Sponsors.\n\n"
    "You are NOT determining whether the company holds a sponsor licence, and "
    "you must not reason about that. The register decides licence status; you "
    "only decide identity.\n\n"
    "Rules:\n"
    "- Select only from the supplied candidates. Never invent an organisation "
    "or return an id that was not supplied.\n"
    "- Use only the supplied evidence. Do not use outside knowledge about these "
    "organisations.\n"
    "- A similar name is not proof of identity. Two different employers "
    "routinely share a word, a founder's surname, or a sector term.\n"
    "- Treat legal suffixes (Ltd, Limited, PLC, LLP) as noise, never as a "
    "distinguishing difference.\n"
    "- Domain or website evidence outranks name similarity when both exist.\n"
    "- Corroborating location raises confidence; conflicting location lowers it.\n"
    "- Only treat a parent/subsidiary relationship as identity when the supplied "
    "evidence states it. Shared branding is not evidence.\n"
    "- If two or more candidates fit comparably, return \"ambiguous\" with a "
    "null selection rather than guessing.\n"
    "- Prefer \"ambiguous\" over a weak \"match\". A wrong match is far more "
    "costly here than an unresolved one.\n\n"
    "In matched_on, list only the signals that actually supported the decision, "
    "drawn from: name_exact, name_variant, domain, city, county, sector, "
    "description."
)

RESOLUTION_SCHEMA = {
    "type": "object",
    "properties": {
        "selected_candidate_id": {"type": ["string", "null"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "decision": {"type": "string", "enum": ["match", "no_match", "ambiguous"]},
        "matched_on": {"type": "array", "items": {"type": "string"}},
        "reasoning": {"type": "string"},
    },
    "required": [
        "selected_candidate_id",
        "confidence",
        "decision",
        "matched_on",
        "reasoning",
    ],
    "additionalProperties": False,
}


@dataclass
class Resolution:
    """The resolution for one company, after the code-side guardrails."""

    company_id: str
    selected_candidate_id: Optional[str]
    confidence: float
    decision: str
    matched_on: list[str] = field(default_factory=list)
    reasoning: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "company_id": self.company_id,
            "selected_candidate_id": self.selected_candidate_id,
            "confidence": round(self.confidence, 2),
            "decision": self.decision,
            "matched_on": self.matched_on,
            "reasoning": self.reasoning,
        }


def build_user_prompt(company: dict[str, Any], candidates: list[dict[str, Any]]) -> str:
    """The comparison payload. Only supplied fields appear — no placeholders."""

    def described(source: dict[str, Any], fields: list[tuple[str, str]]) -> str:
        lines = []
        for key, label in fields:
            value = source.get(key)
            if value not in (None, ""):
                lines.append(f"  {label}: {value}")
        return "\n".join(lines) or "  (no details supplied)"

    company_block = described(
        company,
        [
            ("name", "Name"),
            ("website", "Website"),
            ("city", "City"),
            ("region", "Region"),
            ("hq_location", "HQ location"),
            ("sector", "Sector"),
            ("description", "Description"),
        ],
    )

    candidate_blocks = []
    for candidate in candidates:
        block = described(
            candidate,
            [
                ("organisation_name", "Organisation name"),
                ("town_city", "Town/City"),
                ("county", "County"),
                ("route", "Route"),
                ("licence_type", "Licence type"),
                ("rating", "Rating"),
            ],
        )
        candidate_blocks.append(f"- id: {candidate.get('id')}\n{block}")

    return (
        "Crawled company:\n"
        f"{company_block}\n\n"
        f"Candidate organisations from the register ({len(candidates)}):\n"
        + "\n".join(candidate_blocks)
        + "\n\nDecide whether the crawled company is the same entity as one of "
        "these candidates."
    )


def _coerce(
    company_id: str, payload: dict[str, Any], candidates: list[dict[str, Any]]
) -> Resolution:
    """Apply the guardrails the prompt cannot enforce."""
    valid_ids = {str(candidate.get("id")) for candidate in candidates}

    decision = str(payload.get("decision") or "no_match")
    if decision not in {"match", "no_match", "ambiguous"}:
        decision = "ambiguous"

    selected = payload.get("selected_candidate_id")
    selected = str(selected) if selected else None

    try:
        confidence = float(payload.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    reasoning = str(payload.get("reasoning") or "")
    matched_on = [str(item) for item in (payload.get("matched_on") or [])]

    # An id we did not supply is discarded outright: the model has selected
    # something that is not in the register set it was given.
    if selected and selected not in valid_ids:
        logger.warning(
            "Resolver returned an unsupplied candidate id %r for company %s",
            selected, company_id,
        )
        reasoning = (
            "Model selected an id that was not among the supplied candidates; "
            "discarded. " + reasoning
        )
        selected, decision = None, "ambiguous"

    if decision == "match":
        if not selected:
            decision = "ambiguous"
            reasoning = "Match claimed without selecting a candidate. " + reasoning
        elif confidence < MIN_MATCH_CONFIDENCE:
            decision = "ambiguous"
            reasoning = (
                f"Confidence {confidence:.2f} is below the {MIN_MATCH_CONFIDENCE} "
                "threshold required to record a match. " + reasoning
            )

    # Only a match may carry a selection: an ambiguous result naming one
    # candidate reads as a match to anything that skims the row.
    if decision != "match":
        selected = None

    return Resolution(
        company_id=company_id,
        selected_candidate_id=selected,
        confidence=confidence,
        decision=decision,
        matched_on=matched_on,
        reasoning=reasoning.strip(),
    )


def resolve(
    company: dict[str, Any],
    candidates: list[dict[str, Any]],
    *,
    api_key: str,
    model: str,
    timeout: float = 30.0,
    client: Any = None,
) -> Resolution:
    """Resolve one company against its candidates.

    `client` is injectable so the whole path can be tested without a network
    call. With no candidates there is nothing to resolve and no model is called.
    """
    company_id = str(company.get("id") or "")

    if not candidates:
        return Resolution(
            company_id=company_id,
            selected_candidate_id=None,
            confidence=0.0,
            decision="no_match",
            matched_on=[],
            reasoning=(
                "No register candidates were found for this company, so there is "
                "nothing to resolve against."
            ),
        )

    if client is None:
        import anthropic  # imported lazily; only needed when a call is made

        client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=1)

    message = client.messages.create(
        model=model,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        output_config={
            "effort": "medium",
            "format": {"type": "json_schema", "schema": RESOLUTION_SCHEMA},
        },
        messages=[
            {"role": "user", "content": build_user_prompt(company, candidates)}
        ],
    )

    if getattr(message, "stop_reason", None) == "refusal":
        return Resolution(
            company_id=company_id,
            selected_candidate_id=None,
            confidence=0.0,
            decision="ambiguous",
            matched_on=[],
            reasoning="The model declined to resolve this company.",
        )

    text = "".join(
        block.text
        for block in message.content
        if getattr(block, "type", None) == "text"
    ).strip()

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        logger.error("Resolver returned unparseable output for company %s", company_id)
        return Resolution(
            company_id=company_id,
            selected_candidate_id=None,
            confidence=0.0,
            decision="ambiguous",
            matched_on=[],
            reasoning="The model returned output that could not be parsed.",
        )

    return _coerce(company_id, payload, candidates)
