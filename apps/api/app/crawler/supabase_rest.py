"""Thin async Supabase REST (PostgREST) client using the service role key.

Server-side only — the service role key is never exposed to the frontend.

Every method takes an optional per-call `timeout` that overrides the client
default. Bulk operations need it: the sponsor-register import writes hundreds of
batches into a table with a unique index, and those upserts take far longer than
the interactive requests the 15-second default was chosen for. Raising the
default instead would let an interactive endpoint hang for minutes.
"""

from __future__ import annotations

from typing import Any, Optional

import httpx


class SupabaseRest:
    def __init__(self, base_url: str, service_role_key: str, timeout: float = 15.0):
        self._rest = f"{base_url.rstrip('/')}/rest/v1"
        self._headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout

    async def select(
        self,
        client: httpx.AsyncClient,
        table: str,
        params: Optional[dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> list[dict[str, Any]]:
        response = await client.get(
            f"{self._rest}/{table}",
            params=params or {},
            headers=self._headers,
            timeout=timeout or self._timeout,
        )
        response.raise_for_status()
        return response.json()

    async def count(
        self,
        client: httpx.AsyncClient,
        table: str,
        params: Optional[dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Optional[int]:
        """Number of rows matching `params`, or None if the count is unavailable.

        Uses PostgREST's `Prefer: count=exact`, which reports the total in the
        `Content-Range` header as `<start>-<end>/<total>`. A HEAD request keeps
        the body empty, so counting a six-figure table costs one small response
        rather than the rows themselves.
        """
        response = await client.head(
            f"{self._rest}/{table}",
            params=params or {},
            headers={**self._headers, "Prefer": "count=exact"},
            timeout=timeout or self._timeout,
        )
        response.raise_for_status()
        content_range = response.headers.get("content-range", "")
        _, _, total = content_range.partition("/")
        try:
            return int(total)
        except ValueError:
            return None

    async def insert(
        self,
        client: httpx.AsyncClient,
        table: str,
        rows: list[dict[str, Any]],
        prefer: str = "return=representation",
        timeout: Optional[float] = None,
    ) -> list[dict[str, Any]]:
        if not rows:
            return []
        response = await client.post(
            f"{self._rest}/{table}",
            headers={**self._headers, "Prefer": prefer},
            json=rows,
            timeout=timeout or self._timeout,
        )
        if response.status_code >= 400:
            print(" === SUPABASE INSERT ERROR ===")
            print("TABLE:", table)
            print("STATUS:", response.status_code)
            print("PAYLOAD:", rows)
            print("RESPONSE:", response.text)
            print("============================ ")
        response.raise_for_status()
        if prefer.startswith("return=representation"):
            return response.json()
        return []

    async def upsert(
        self,
        client: httpx.AsyncClient,
        table: str,
        rows: list[dict[str, Any]],
        on_conflict: str,
        prefer: str = "resolution=merge-duplicates,return=representation",
        timeout: Optional[float] = None,
    ) -> list[dict[str, Any]]:
        if not rows:
            return []
        response = await client.post(
            f"{self._rest}/{table}",
            params={"on_conflict": on_conflict},
            headers={**self._headers, "Prefer": prefer},
            json=rows,
            timeout=timeout or self._timeout,
        )
        response.raise_for_status()
        if "return=representation" in prefer:
            return response.json()
        return []

    async def update(
        self,
        client: httpx.AsyncClient,
        table: str,
        match: dict[str, str],
        values: dict[str, Any],
        prefer: str = "return=minimal",
        timeout: Optional[float] = None,
    ) -> None:
        response = await client.patch(
            f"{self._rest}/{table}",
            params=match,
            headers={**self._headers, "Prefer": prefer},
            json=values,
            timeout=timeout or self._timeout,
        )
        if response.status_code >= 400:
            # TEMPORARY diagnostics — remove after investigation.
            print(" === SUPABASE UPDATE ERROR ===", flush=True)
            print("TABLE:", table, flush=True)
            print("STATUS:", response.status_code, flush=True)
            print("MATCH:", match, flush=True)
            print("VALUE KEYS:", list(values.keys()), flush=True)
            print("RESPONSE:", response.text, flush=True)
            print("============================ ", flush=True)
        response.raise_for_status()
