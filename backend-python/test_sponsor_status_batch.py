"""Self-check for the batched sponsorship status endpoint (list badge).

`python test_sponsor_status_batch.py` — offline.

The outreach company list can show many companies at once; badging each one
by calling GET /sponsors/companies/{id} in a loop would be an N+1 the browser
pays for on every page load. `bulk_company_sponsorship_status` /
POST /sponsors/companies/statuses answer the same question — reusing the same
`_classify_check` state machine `company_sponsorship_status` uses — in a
constant number of database round trips regardless of how many companies are
asked for.
"""

from __future__ import annotations

import asyncio
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key")

from app.sponsors.service import bulk_company_sponsorship_status  # noqa: E402

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


class FakeRest:
    def __init__(self) -> None:
        self.licences: list[dict] = []
        self.links: list[dict] = []
        self.checks: list[dict] = []
        self.imports: list[dict] = []
        self.select_calls: list[tuple[str, dict]] = []

    async def select(self, client, table, params=None, timeout=None):
        params = params or {}
        self.select_calls.append((table, dict(params)))
        rows = {
            "sponsor_licences": self.licences,
            "company_sponsorship": self.links,
            "company_sponsorship_checks": self.checks,
            "sponsor_register_imports": self.imports,
        }.get(table, [])
        return [dict(r) for r in rows if self._matches(r, params)][
            : int(params.get("limit", "1000"))
        ]

    @staticmethod
    def _matches(row: dict, params: dict) -> bool:
        for key, value in params.items():
            if key in ("select", "order", "limit") or not isinstance(value, str):
                continue
            actual = row.get(key)
            if value == "is.null":
                if actual is not None:
                    return False
            elif value.startswith("eq."):
                target = value[3:]
                if target in ("true", "false"):
                    if bool(actual) != (target == "true"):
                        return False
                elif str(actual) != target:
                    return False
            elif value.startswith("in.("):
                wanted = {v for v in value[4:-1].split(",") if v}
                if str(actual) not in wanted:
                    return False
        return True


LATEST_IMPORT = "import-latest"
OLD_IMPORT = "import-old"


def base_rest() -> FakeRest:
    rest = FakeRest()
    rest.imports = [{"id": LATEST_IMPORT, "status": "success"}]
    return rest


def statuses(rest: FakeRest, ids: list[str]) -> dict:
    return asyncio.run(bulk_company_sponsorship_status(object(), rest, ids))


# ---------------------------------------------------------------------------
# Mixed statuses in one call.
# ---------------------------------------------------------------------------
rest = base_rest()
rest.licences = [{
    "id": "lic-1", "is_current": True,
}]
rest.links = [{
    "company_id": "co-licensed", "sponsor_licence_id": "lic-1", "decision": "match",
    "resolved_at": "2026-01-01T00:00:00Z",
}]
rest.checks = [
    {"company_id": "co-licensed", "last_decision": "match",
     "register_import_id": LATEST_IMPORT, "candidate_count": 1,
     "checked_at": "2026-01-02T00:00:00Z"},
    {"company_id": "co-ambiguous", "last_decision": "ambiguous",
     "register_import_id": LATEST_IMPORT, "candidate_count": 2,
     "checked_at": "2026-01-02T00:00:00Z"},
    {"company_id": "co-nomatch", "last_decision": "no_match",
     "register_import_id": LATEST_IMPORT, "candidate_count": 0,
     "checked_at": "2026-01-02T00:00:00Z"},
    {"company_id": "co-error", "last_decision": "error",
     "register_import_id": LATEST_IMPORT, "candidate_count": 0,
     "checked_at": "2026-01-02T00:00:00Z",
     "error": "APIConnectionError: 10.0.4.12:443 key=sk-ant-***"},
]

ids = ["co-licensed", "co-ambiguous", "co-nomatch", "co-error", "co-unchecked"]
result = statuses(rest, ids)

check("mixed batch: licensed", result["co-licensed"]["status"] == "licensed",
      f"got {result['co-licensed']}")
check("mixed batch: ambiguous", result["co-ambiguous"]["status"] == "ambiguous")
check("mixed batch: no_match", result["co-nomatch"]["status"] == "no_match")
check("mixed batch: error", result["co-error"]["status"] == "error")
check("mixed batch: never-checked company is not_checked",
      result["co-unchecked"]["status"] == "not_checked")
check("mixed batch: every requested id has a row, even the unchecked one",
      set(result) == set(ids), f"got {sorted(result)}")
check("mixed batch: the error entry never carries the raw error text",
      "APIConnectionError" not in str(result["co-error"])
      and "sk-ant" not in str(result["co-error"]))
check("mixed batch: no organisation name, routes or confidence anywhere",
      "organisation_name" not in str(result) and "routes" not in str(result)
      and "confidence" not in str(result))

# The service function shares its classifier's full internal dict (it also
# backs the single-company endpoint's response); trimming to the public
# {status, stale, checked_at} contract happens at the API boundary via
# CompanySponsorshipStatusCompact, exercised directly here — this is exactly
# what app/routers/sponsors.py does before anything reaches the browser.
from app.schemas import CompanySponsorshipStatusCompact  # noqa: E402

compact = CompanySponsorshipStatusCompact(**result["co-error"])
check("the response model trims a raw classifier dict to the compact contract",
      compact.model_dump() == {
          "status": "error", "stale": False, "checked_at": "2026-01-02T00:00:00Z",
      },
      f"got {compact.model_dump()}")

# ---------------------------------------------------------------------------
# Stale check handled the same way the single-company endpoint handles it.
# ---------------------------------------------------------------------------
rest2 = base_rest()
rest2.checks = [{
    "company_id": "co-stale", "last_decision": "no_match",
    "register_import_id": OLD_IMPORT, "candidate_count": 0,
    "checked_at": "2025-06-01T00:00:00Z",
}]
result = statuses(rest2, ["co-stale"])
check("stale: reported as not_checked, not the stale decision",
      result["co-stale"]["status"] == "not_checked",
      f"got {result['co-stale']['status']}")
check("stale: flagged", result["co-stale"]["stale"] is True)
check("stale: the old check's checked_at is still surfaced",
      result["co-stale"]["checked_at"] == "2025-06-01T00:00:00Z")

# ---------------------------------------------------------------------------
# Unknown company id: present in the request, absent from checks/links —
# must not crash and must resolve to not_checked like any other unchecked id.
# ---------------------------------------------------------------------------
rest3 = base_rest()
result = statuses(rest3, ["does-not-exist"])
check("unknown company id does not crash", "does-not-exist" in result)
check("unknown company id reads as not_checked",
      result["does-not-exist"]["status"] == "not_checked")

# ---------------------------------------------------------------------------
# Empty request.
# ---------------------------------------------------------------------------
result = statuses(base_rest(), [])
check("an empty id list returns an empty result, no queries", result == {})

# ---------------------------------------------------------------------------
# Bounded query count: proves this does not degrade into one round trip per
# company (the entire point of the batch endpoint existing).
# ---------------------------------------------------------------------------
rest4 = base_rest()
many_ids = [f"co-{i}" for i in range(250)]
rest4.checks = [
    {"company_id": cid, "last_decision": "no_match",
     "register_import_id": LATEST_IMPORT, "candidate_count": 0,
     "checked_at": "2026-01-02T00:00:00Z"}
    for cid in many_ids[:10]  # only some have checks; the rest are unchecked
]
asyncio.run(bulk_company_sponsorship_status(object(), rest4, many_ids))
check("250 companies costs a small, bounded number of queries, not one each",
      len(rest4.select_calls) < 10, f"got {len(rest4.select_calls)} select calls")


# ---------------------------------------------------------------------------
# HTTP layer: auth enforced, response shape matches the compact contract.
# ---------------------------------------------------------------------------
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import get_current_user  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import sponsors  # noqa: E402

get_settings.cache_clear()


class _ConstantRest:
    def __new__(cls, *args, **kwargs):
        return _http_fixture["rest"]


_http_fixture: dict = {"rest": None}
sponsors.SupabaseRest = _ConstantRest  # type: ignore[assignment]

http_client = TestClient(app)


def _authenticated() -> None:
    app.dependency_overrides[get_current_user] = lambda: "coach-1"


def _anonymous() -> None:
    app.dependency_overrides.pop(get_current_user, None)


_anonymous()
response = http_client.post(
    "/sponsors/companies/statuses", json={"company_ids": ["co-1"]}
)
check("unauthenticated batch request is rejected",
      response.status_code == 401, f"got {response.status_code}")

_authenticated()
fixture_rest = base_rest()
fixture_rest.checks = [{
    "company_id": "co-http-a", "last_decision": "ambiguous",
    "register_import_id": LATEST_IMPORT, "candidate_count": 2,
    "checked_at": "2026-01-02T00:00:00Z",
}]
_http_fixture["rest"] = fixture_rest

response = http_client.post(
    "/sponsors/companies/statuses",
    json={"company_ids": ["co-http-a", "co-http-b"]},
)
check("authenticated batch request succeeds",
      response.status_code == 200, f"got {response.status_code}")
body = response.json()
check("both requested ids are present in the response",
      set(body) == {"co-http-a", "co-http-b"}, f"got {sorted(body)}")
check("the ambiguous entry has the right compact shape",
      body["co-http-a"] == {
          "status": "ambiguous", "stale": False, "checked_at": "2026-01-02T00:00:00Z",
      },
      f"got {body['co-http-a']}")
check("the never-checked entry is not_checked",
      body["co-http-b"]["status"] == "not_checked")
check("no detailed sponsorship data anywhere in the HTTP response",
      "organisation_name" not in response.text and "routes" not in response.text
      and "confidence" not in response.text)

_anonymous()


print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL SPONSOR STATUS BATCH TESTS PASSED")
