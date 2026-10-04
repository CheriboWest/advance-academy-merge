"""Industry sector for a company — the only writer of `companies.sector`.

Replaces the old homepage keyword guess in crawler/enrich.py, which only ran
for companies with a website (the crawler's Adzuna/Reed companies have none)
and knew five sectors, so the public sector filter matched almost nothing.

One Claude call per batch of companies: name plus a few active job titles in,
one sector per company out, constrained to SECTORS by the output schema.
"Unknown" is stored as NULL so a later run can try again.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

import httpx

from app.crawler.supabase_rest import SupabaseRest

# Keep in sync with SECTOR_OPTIONS in features/career-hub/lib/filters.ts —
# the public filter is an exact match on these strings.
SECTORS: tuple[str, ...] = (
    "Technology",
    "Finance & Banking",
    "Insurance",
    "Accounting & Professional Services",
    "Consulting",
    "Legal",
    "Healthcare",
    "Pharma & Life Sciences",
    "Education",
    "Retail & E-commerce",
    "Hospitality & Leisure",
    "Media, Marketing & Advertising",
    "Engineering & Manufacturing",
    "Construction & Property",
    "Energy & Utilities",
    "Logistics & Transport",
    "Public Sector",
    "Charity & Non-profit",
    "Telecoms",
    "Recruitment & HR",
)
UNKNOWN = "Unknown"

BATCH_SIZE = 50
TITLES_PER_COMPANY = 5

SYSTEM_PROMPT = (
    "You classify UK employers into one industry sector each, for a job "
    "search filter. Judge the company's own industry, not the role: a bank "
    "hiring software engineers is Finance & Banking. Use the company name and "
    "the sample job titles. A recruitment agency is Recruitment & HR. If you "
    f"cannot tell with reasonable confidence, answer {UNKNOWN}."
)

SECTOR_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "n": {"type": "integer"},
                    "sector": {"type": "string", "enum": [*SECTORS, UNKNOWN]},
                },
                "required": ["n", "sector"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["results"],
    "additionalProperties": False,
}


def build_prompt(companies: list[dict[str, Any]]) -> str:
    """Numbered rather than keyed by uuid: shorter, and the model can't
    hand back an id that isn't in the batch."""
    lines = []
    for n, company in enumerate(companies, start=1):
        titles = "; ".join(company.get("titles") or []) or "no job titles"
        lines.append(f"{n}. {company['name']} — {titles}")
    return "Classify each company:\n" + "\n".join(lines)


def parse_sectors(text: str, companies: list[dict[str, Any]]) -> dict[str, Optional[str]]:
    """Model output → {company_id: sector or None}. Anything outside the
    batch or outside SECTORS is dropped/None rather than trusted."""
    result: dict[str, Optional[str]] = {}
    for item in json.loads(text).get("results", []):
        n = item.get("n")
        if not isinstance(n, int) or not 1 <= n <= len(companies):
            continue
        sector = item.get("sector")
        result[companies[n - 1]["id"]] = sector if sector in SECTORS else None
    return result


def classify_batch(
    companies: list[dict[str, Any]], *, api_key: str, model: str, timeout: float
) -> dict[str, Optional[str]]:
    """One Claude call for up to BATCH_SIZE companies. Raises on failure."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=1)
    message = client.messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        output_config={"format": {"type": "json_schema", "schema": SECTOR_SCHEMA}},
        messages=[{"role": "user", "content": build_prompt(companies)}],
    )
    text = "".join(
        block.text for block in message.content if getattr(block, "type", None) == "text"
    )
    return parse_sectors(text, companies)


async def _with_titles(
    client: httpx.AsyncClient, rest: SupabaseRest, companies: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Attach a few active job titles per company. One small request each:
    a single `in.(...)` query would let a company with hundreds of jobs
    crowd the rest out of PostgREST's 1,000-row page."""

    async def titles(company_id: str) -> list[str]:
        rows = await rest.select(
            client,
            "jobs",
            {
                "company_id": f"eq.{company_id}",
                "is_active": "eq.true",
                "select": "title",
                "limit": str(TITLES_PER_COMPANY),
            },
        )
        return [row["title"].strip() for row in rows if (row.get("title") or "").strip()]

    all_titles = await asyncio.gather(*(titles(c["id"]) for c in companies))
    return [{**c, "titles": t} for c, t in zip(companies, all_titles)]


async def classify_and_store(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    companies: list[dict[str, Any]],
    *,
    api_key: str,
    model: str,
    timeout: float,
) -> int:
    """Classify `companies` ({id, name}) in batches and write the sectors.
    Returns how many got a sector. A failed batch is skipped, not fatal."""
    stored = 0
    for start in range(0, len(companies), BATCH_SIZE):
        batch = await _with_titles(client, rest, companies[start : start + BATCH_SIZE])
        try:
            # Synchronous SDK call — off the event loop, like the summariser.
            sectors = await asyncio.to_thread(
                classify_batch, batch, api_key=api_key, model=model, timeout=timeout
            )
        except Exception as exc:  # noqa: BLE001 — one bad batch shouldn't stop the rest
            print(f"[sector] batch at {start} failed: {type(exc).__name__}: {exc}", flush=True)
            continue
        for company_id, sector in sectors.items():
            if sector:
                await rest.update(client, "companies", {"id": f"eq.{company_id}"}, {"sector": sector})
                stored += 1
    return stored


async def unclassified(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    company_ids: Optional[list[str]] = None,
    *,
    after_id: Optional[str] = None,
    limit: int = 1000,
) -> list[dict[str, Any]]:
    """Companies with no sector yet — all of them, or only among `company_ids`.

    Keyset-paged on id (`after_id`), not offset: classifying a page removes
    its rows from `sector is null`, which would make an offset skip rows."""
    params = {"sector": "is.null", "select": "id,name", "order": "id", "limit": str(limit)}
    if after_id:
        params["id"] = f"gt.{after_id}"
    if company_ids is not None:
        if not company_ids:
            return []
        params["id"] = f"in.({','.join(company_ids)})"
    return await rest.select(client, "companies", params)
