"""Thin async Supabase REST (PostgREST) client using the service role key.

Server-side only — the service role key is never exposed to the frontend.
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
    ) -> list[dict[str, Any]]:
        response = await client.get(
            f"{self._rest}/{table}",
            params=params or {},
            headers=self._headers,
            timeout=self._timeout,
        )
        response.raise_for_status()
        return response.json()

    async def insert(
        self,
        client: httpx.AsyncClient,
        table: str,
        rows: list[dict[str, Any]],
        prefer: str = "return=representation",
    ) -> list[dict[str, Any]]:
        if not rows:
            return []
        response = await client.post( f"{self._rest}/{table}", headers={**self._headers, "Prefer": prefer}, json=rows, timeout=self._timeout, )
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
    ) -> list[dict[str, Any]]:
        if not rows:
            return []
        response = await client.post(
            f"{self._rest}/{table}",
            params={"on_conflict": on_conflict},
            headers={**self._headers, "Prefer": prefer},
            json=rows,
            timeout=self._timeout,
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
    ) -> None:
        response = await client.patch(
            f"{self._rest}/{table}",
            params=match,
            headers={**self._headers, "Prefer": prefer},
            json=values,
            timeout=self._timeout,
        )
        response.raise_for_status()
