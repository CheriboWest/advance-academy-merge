"""Self-check for GET /sponsors/stats — the coach dashboard's sponsor KPI.

`python test_sponsor_stats.py` — offline.

The endpoint is one count, so this is one layer (a `TestClient` over a fake
`SupabaseRest`) rather than the service + router split
test_sponsor_status_endpoint.py needs: there is no state machine here to
exercise separately. What must hold:

  A. It counts `company_sponsorship_current` — the confirmed-and-live view the
     per-company `licensed` status is derived from — and not the raw
     `company_sponsorship` link table, which also holds `ambiguous` and
     `no_match` rows and would inflate the KPI.
  B. An unavailable count (PostgREST omitting content-range) reports 0 rather
     than 500ing the dashboard.
  C. It is coach-gated the same way every other route on this router is: no
     valid Supabase session → 401.
"""

from __future__ import annotations

import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key")

from typing import Any, Optional  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.auth import get_current_user  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import sponsors  # noqa: E402

get_settings.cache_clear()

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


class FakeRest:
    """Stands in for SupabaseRest: records what was counted, returns a fixture."""

    def __init__(self, total: Optional[int]) -> None:
        self.total = total
        self.counted: list[tuple[str, dict[str, Any]]] = []

    async def count(self, client, table, params=None, timeout=None):
        self.counted.append((table, dict(params or {})))
        return self.total


_fixture: dict = {"rest": None}


class _ConstantRest:
    """Returns the current fixture regardless of the ctor args the router passes."""

    def __new__(cls, *args, **kwargs):
        return _fixture["rest"]


sponsors.SupabaseRest = _ConstantRest  # type: ignore[assignment]

http_client = TestClient(app)
COACH_ID = "aaaaaaaa-0000-0000-0000-00000000000a"

# --- A: the count comes from the confirmed-and-live view ---------------------
app.dependency_overrides[get_current_user] = lambda: COACH_ID
_fixture["rest"] = FakeRest(221)

response = http_client.get("/sponsors/stats")
check("A: an authenticated coach reaches the handler (200)",
      response.status_code == 200, f"got {response.status_code}")
check("A: the licensed count is reported as-is",
      response.json() == {"licensed_companies": 221}, f"got {response.json()}")
check("A: counted company_sponsorship_current, not the raw link table",
      [t for t, _ in _fixture["rest"].counted] == ["company_sponsorship_current"],
      f"got {_fixture['rest'].counted}")

# --- B: an unavailable count is 0, not a 500 --------------------------------
_fixture["rest"] = FakeRest(None)
response = http_client.get("/sponsors/stats")
check("B: an unavailable count degrades to 0",
      response.status_code == 200 and response.json() == {"licensed_companies": 0},
      f"got {response.status_code} {response.text}")

# --- C: coach-gated ---------------------------------------------------------
app.dependency_overrides.pop(get_current_user, None)
check("C: an unauthenticated request is rejected",
      http_client.get("/sponsors/stats").status_code == 401,
      f"got {http_client.get('/sponsors/stats').status_code}")

print()
if _failures:
    print(f"{len(_failures)} check(s) failed:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("All checks passed.")
