"""Deterministic candidate search against the sponsor register.

Claude never sees the register. The database narrows tens of thousands of rows
to a handful using indexed lookups, and only those go to the model. That keeps
the prompt small and, more importantly, keeps the expensive judgement confined
to cases a cheap comparison could not settle.

Strategies run in order of decreasing precision and stop as soon as the cap is
reached, so an exact-name company costs one indexed equality lookup.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

import httpx

from app.crawler.supabase_rest import SupabaseRest
from app.sponsors.normalize import name_prefix, normalize_organisation_name, normalize_town

logger = logging.getLogger("careerhub.sponsors.candidates")

TABLE = "sponsor_licences"
COLUMNS = (
    "id,organisation_name,town_city,county,route,licence_type,rating,"
    "normalized_name,normalized_town"
)

# How many candidates may reach the model. Small on purpose: if a company has
# more plausible register rows than this, name similarity alone is not going to
# resolve it and a human should look.
MAX_CANDIDATES = 12
# A prefix shorter than this matches far too much of the register to be useful.
MIN_PREFIX_LENGTH = 4

_UNSAFE_FILTER_RE = re.compile(r'[,"()\\*]')


def _safe_for_filter(value: str) -> bool:
    """Whether a value can go into a PostgREST filter without escaping games."""
    return bool(value) and not _UNSAFE_FILTER_RE.search(value)


class CandidateSearch:
    """Finds plausible register rows for one crawled company."""

    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def _query(
        self, client: httpx.AsyncClient, params: dict[str, str]
    ) -> list[dict[str, Any]]:
        return await self._rest.select(
            client,
            TABLE,
            {"select": COLUMNS, "is_current": "eq.true", **params},
        )

    async def find(
        self,
        client: httpx.AsyncClient,
        *,
        name: str,
        city: Optional[str] = None,
        limit: int = MAX_CANDIDATES,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """Candidate register rows for a company, plus the strategies that hit.

        Returns `([], [...])` when nothing plausible exists — which is a real
        answer, not a failure, and must not be turned into a match downstream.
        """
        normalized = normalize_organisation_name(name)
        if not normalized:
            return [], []

        town = normalize_town(city)
        found: dict[str, dict[str, Any]] = {}
        strategies: list[str] = []

        def absorb(rows: list[dict[str, Any]], label: str) -> None:
            added = False
            for row in rows:
                row_id = row.get("id")
                if row_id and str(row_id) not in found:
                    found[str(row_id)] = row
                    added = True
            if added:
                strategies.append(label)

        # 1. Exact normalized name, narrowed by town. The strongest signal the
        #    database can offer on its own.
        if _safe_for_filter(normalized):
            if town and _safe_for_filter(town):
                absorb(
                    await self._query(
                        client,
                        {
                            "normalized_name": f"eq.{normalized}",
                            "normalized_town": f"eq.{town}",
                            "limit": str(limit),
                        },
                    ),
                    "exact_name_and_town",
                )
            if len(found) < limit:
                absorb(
                    await self._query(
                        client,
                        {"normalized_name": f"eq.{normalized}", "limit": str(limit)},
                    ),
                    "exact_name",
                )

        # 2. Name prefix — catches "Acme Fintech" against "Acme Fintech Group",
        #    which is a genuine candidate but NOT by itself evidence of identity.
        prefix = name_prefix(normalized)
        if (
            len(found) < limit
            and len(prefix) >= MIN_PREFIX_LENGTH
            and _safe_for_filter(prefix)
        ):
            absorb(
                await self._query(
                    client,
                    {
                        "normalized_name": f"like.{prefix}*",
                        "limit": str(limit - len(found)),
                    },
                ),
                "name_prefix",
            )

        # 3. Same town, name containing the first word. Last resort, and only
        #    when a town is known — without one this degenerates into a scan.
        first_word = normalized.split()[0] if normalized.split() else ""
        if (
            len(found) < limit
            and town
            and _safe_for_filter(town)
            and len(first_word) >= MIN_PREFIX_LENGTH
            and _safe_for_filter(first_word)
        ):
            absorb(
                await self._query(
                    client,
                    {
                        "normalized_town": f"eq.{town}",
                        "normalized_name": f"like.*{first_word}*",
                        "limit": str(limit - len(found)),
                    },
                ),
                "town_and_name_fragment",
            )

        candidates = list(found.values())[:limit]
        logger.info(
            "Candidate search for %r (city=%r): %d candidates via %s",
            name, city, len(candidates), strategies or ["none"],
        )
        return candidates, strategies
