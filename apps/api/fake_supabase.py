"""An in-memory stand-in for Supabase, shared by the sponsor-import self-checks.

Shared on purpose. These tests turn on properties the database enforces — the
unique index on `natural_key`, PostgREST updating only the columns a payload
carries, `is_current` defaulting to false since migration 0009, and what
`finalize_sponsor_register_import()` promotes and withdraws. A double that
drifts from any of those turns a test suite into a suite of reassurances, which
is exactly how earlier bugs here survived their tests.

The finalization RPC mirrors `infra/supabase/migrations/0009_...sql` statement
for statement. Change one and change the other.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Optional

import httpx

LICENCES = "sponsor_licences"
IMPORTS = "sponsor_register_imports"
FINALIZE = "finalize_sponsor_register_import"

# Column defaults `sponsor_licences` applies to a row PostgREST inserts without
# them. `is_current` is false as of 0009: a row is not live until an import
# finishes.
_INSERT_DEFAULTS = {
    "is_current": False,
    "withdrawn_at": None,
    "staged_import_id": None,
    "staged_seen_at": None,
    "last_import_id": None,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PostgrestError(httpx.HTTPStatusError):
    """What PostgREST returns when a plpgsql RAISE reaches it: a 4xx, not a crash."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        request = httpx.Request("POST", "https://fake/rest/v1/rpc")
        super().__init__(
            message,
            request=request,
            response=httpx.Response(status_code, request=request, text=message),
        )


class FakeSupabase:
    """Enough of PostgREST and the sponsor schema to test the import path."""

    def __init__(self, rows: Optional[list[dict]] = None) -> None:
        self.licences: dict[str, dict] = {}
        for row in rows or []:
            self.licences[row["natural_key"]] = {**_INSERT_DEFAULTS, **row}
        self.imports: list[dict] = []

        # Observations the tests assert on.
        self.requests: list[str] = []
        self.licence_selects: list[dict] = []
        self.upsert_sizes: list[int] = []
        self.write_timeouts: list[Optional[float]] = []
        self.rpc_calls: list[tuple[str, dict]] = []
        self.update_clients: list[Any] = []

        # Injected failure. `should_fail(rows)` decides whether an upsert
        # raises; the decision is made on the rows because a split re-sends
        # subsets and a batch number would not survive it.
        self.should_fail: Callable[[list[dict]], bool] = lambda rows: False
        self.commit_on_failure = False
        self.failures = 0
        self.rpc_failures = 0
        self.fail_rpc_times = 0
        self.error_factory: Callable[[], Exception] = lambda: httpx.ReadTimeout(
            "timed out", request=httpx.Request("POST", "https://fake/rest/v1")
        )

    # -- reads --------------------------------------------------------------
    async def select(self, client, table, params=None, timeout=None):
        params = params or {}
        self.requests.append(f"select:{table}")
        if table == IMPORTS:
            rows = list(self.imports)
            status = params.get("status")
            if status and status.startswith("eq."):
                rows = [r for r in rows if r.get("status") == status[3:]]
            if (params.get("order") or "").startswith("started_at.desc"):
                rows = list(reversed(rows))
            return [dict(r) for r in rows][: int(params.get("limit", "50"))]
        if table == LICENCES:
            # Recorded so a test can prove the importer no longer pages the
            # whole table before writing anything.
            self.licence_selects.append(dict(params))
            offset = int(params.get("offset", "0"))
            limit = int(params.get("limit", "1000"))
            ordered = sorted(self.licences.values(), key=lambda r: r["natural_key"])
            return [dict(r) for r in ordered[offset : offset + limit]]
        return []

    async def count(self, client, table, params=None, timeout=None):
        if table == LICENCES:
            return len([r for r in self.licences.values() if r.get("is_current")])
        return len(self.imports)

    # -- writes -------------------------------------------------------------
    async def insert(self, client, table, rows, prefer="return=representation",
                     timeout=None):
        self.requests.append(f"insert:{table}")
        if table == IMPORTS:
            created = [
                {**row, "id": f"import-{len(self.imports) + 1}"} for row in rows
            ]
            self.imports.extend(created)
            return created
        return rows

    async def upsert(self, client, table, rows, on_conflict, prefer="", timeout=None):
        assert table == LICENCES, table
        assert on_conflict == "natural_key", on_conflict
        assert "resolution=merge-duplicates" in prefer, prefer
        assert "return=minimal" in prefer, prefer
        # PostgREST builds one INSERT for the whole array, so every object has
        # to carry the same keys.
        shapes = {tuple(sorted(row)) for row in rows}
        assert len(shapes) <= 1, f"rows in one batch differ in shape: {shapes}"

        self.requests.append(f"upsert:{table}")
        self.upsert_sizes.append(len(rows))
        self.write_timeouts.append(timeout)

        if self.should_fail(rows):
            self.failures += 1
            if self.commit_on_failure:
                # A timeout does not prove the server discarded the write.
                self._apply(rows)
            raise self.error_factory()

        self._apply(rows)
        return []

    def _apply(self, rows: list[dict]) -> None:
        for row in rows:
            key = row["natural_key"]
            existing = self.licences.get(key)
            if existing is None:
                self.licences[key] = {
                    **_INSERT_DEFAULTS,
                    "id": f"lic-{len(self.licences) + 1}",
                    "first_seen_at": _now(),
                    "last_seen_at": _now(),
                    **row,
                }
            else:
                # ON CONFLICT DO UPDATE SET only the columns the payload
                # carries. Everything else — crucially is_current, withdrawn_at
                # and last_seen_at — is left exactly as it was.
                existing.update(row)

    async def update(self, client, table, match, values, prefer="", timeout=None):
        self.requests.append(f"update:{table}")
        self.update_clients.append(client)
        if getattr(client, "should_fail", False):
            raise self.error_factory()
        if table == IMPORTS:
            run_id = match.get("id", "").removeprefix("eq.")
            for record in self.imports:
                if record["id"] == run_id:
                    record.update(values)
        return None

    # -- the finalization function -----------------------------------------
    async def rpc(self, client, function, payload=None, timeout=None):
        payload = payload or {}
        self.requests.append(f"rpc:{function}")
        self.rpc_calls.append((function, dict(payload)))

        if self.fail_rpc_times > 0:
            self.fail_rpc_times -= 1
            self.rpc_failures += 1
            raise self.error_factory()

        assert function == FINALIZE, function
        import_id = payload["p_import_id"]

        record = next((r for r in self.imports if r["id"] == import_id), None)
        if record is None:
            raise PostgrestError(f"import {import_id} does not exist")
        if record.get("status") == "error":
            raise PostgrestError(
                f"import {import_id} is already recorded as failed"
            )

        staged = [
            row for row in self.licences.values()
            if row.get("staged_import_id") == import_id
        ]
        if not staged:
            raise PostgrestError(
                f"import {import_id} staged no rows; refusing to withdraw the "
                "register"
            )

        now = _now()
        for row in staged:
            row.update({
                "is_current": True,
                "withdrawn_at": None,
                "last_seen_at": now,
                "last_import_id": import_id,
            })

        withdrawn = [
            row for row in self.licences.values()
            if row.get("is_current") and row.get("staged_import_id") != import_id
        ]
        for row in withdrawn:
            row.update({"is_current": False, "withdrawn_at": now})

        return [{
            "rows_promoted": len(staged),
            "rows_withdrawn": len(withdrawn),
            "rows_current": len(
                [r for r in self.licences.values() if r.get("is_current")]
            ),
        }]

    # -- convenience for assertions ----------------------------------------
    @property
    def rows(self) -> list[dict]:
        return list(self.licences.values())

    def current(self) -> list[dict]:
        return [r for r in self.licences.values() if r.get("is_current")]

    def current_names(self) -> set[str]:
        return {r["organisation_name"] for r in self.current()}

    def status(self) -> str:
        return self.imports[-1].get("status", "?") if self.imports else "?"
