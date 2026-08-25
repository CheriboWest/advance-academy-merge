"""Self-check for outreach tracking written on a successful send.

`python test_email_send.py` — offline, no real network: httpx.AsyncClient is
patched to route through httpx.MockTransport, so both the Supabase REST calls
and the Resend call are intercepted in-process.

Regression cover for the same "assumed column exists" failure mode this
session has hit twice before (crawl_runs, then almost again with
outreach_emails.jobs_found): the tracking columns migration 0012 adds might
not have reached the live database yet, and the send endpoint must not let
that turn a successful send into a 502 — see _is_missing_column_error's
tiered write in app/routers/email.py.
"""

from __future__ import annotations

import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key")
os.environ.setdefault("RESEND_API_KEY", "resend-test-key")
os.environ.setdefault("EMAIL_FROM", "coach@example.com")

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import get_current_user  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import email as email_router  # noqa: E402

get_settings.cache_clear()

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


COACH_ID = "aaaaaaaa-0000-0000-0000-00000000000a"
DRAFT_ID = "dddddddd-1111-1111-1111-111111111111"

DRAFT_ROW = {
    "id": DRAFT_ID,
    "coach_user_id": COACH_ID,
    "company_id": "cccccccc-0000-0000-0000-00000000000c",
    "subject": "Hello",
    "body": "This is the draft body.",
    "status": "draft",
}


class Scenario:
    """Records every outreach_emails PATCH payload; optionally rejects the
    first one with a missing-column error to exercise the fallback."""

    def __init__(self, reject_full_payload: bool = False) -> None:
        self.reject_full_payload = reject_full_payload
        self.patch_payloads: list[dict] = []
        self.patch_count = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.resend.com" in url:
            return httpx.Response(200, json={"id": "resend-message-id"})

        if "outreach_emails" in url and request.method == "GET":
            return httpx.Response(200, json=[DRAFT_ROW])

        if "outreach_emails" in url and request.method == "PATCH":
            import json as _json

            payload = _json.loads(request.content)
            self.patch_count += 1
            if self.reject_full_payload and "recipient_email" in payload:
                return httpx.Response(
                    400,
                    json={
                        "code": "PGRST204",
                        "message": "Could not find the 'recipient_email' "
                        "column of 'outreach_emails' in the schema cache",
                    },
                )
            self.patch_payloads.append(payload)
            return httpx.Response(200, json=[])

        raise AssertionError(f"unexpected request: {request.method} {url}")


_active: dict = {"scenario": None}
_original_async_client = email_router.httpx.AsyncClient


def _patched_async_client(*args, **kwargs):
    scenario: Scenario = _active["scenario"]
    kwargs["transport"] = httpx.MockTransport(scenario.handler)
    return _original_async_client(*args, **kwargs)


email_router.httpx.AsyncClient = _patched_async_client  # type: ignore[assignment]

http_client = TestClient(app)
app.dependency_overrides[get_current_user] = lambda: COACH_ID

# ---------------------------------------------------------------------------
# 1. A normal send writes status + sent_at + last_contacted_at +
#    recipient_email in one PATCH — the tracking record a successful send
#    must produce.
# ---------------------------------------------------------------------------
scenario = Scenario()
_active["scenario"] = scenario

response = http_client.post(
    "/email/send", json={"draft_id": DRAFT_ID, "to": "recruiter@acme.example"}
)
check("a normal send succeeds (200)", response.status_code == 200,
      f"got {response.status_code} {response.text}")
check("exactly one PATCH was made", scenario.patch_count == 1,
      f"got {scenario.patch_count}")
check("the PATCH carries all four tracking fields",
      len(scenario.patch_payloads) == 1
      and scenario.patch_payloads[0].get("status") == "sent"
      and bool(scenario.patch_payloads[0].get("sent_at"))
      and scenario.patch_payloads[0].get("last_contacted_at")
      == scenario.patch_payloads[0].get("sent_at")
      and scenario.patch_payloads[0].get("recipient_email") == "recruiter@acme.example",
      f"got {scenario.patch_payloads}")

body = response.json()
check("the response reports the recipient", body.get("recipient_email") == "recruiter@acme.example")

# ---------------------------------------------------------------------------
# 2. A database still missing the tracking columns (migration 0012 not yet
#    applied) falls back to the original two-field write instead of losing
#    the send confirmation — the exact bug class this pattern already fixed
#    once for crawl_runs.
# ---------------------------------------------------------------------------
scenario_fallback = Scenario(reject_full_payload=True)
_active["scenario"] = scenario_fallback

response = http_client.post(
    "/email/send", json={"draft_id": DRAFT_ID, "to": "recruiter@acme.example"}
)
check("send still succeeds when tracking columns are missing (200)",
      response.status_code == 200, f"got {response.status_code} {response.text}")
check("the fallback took two PATCH attempts (full, then reduced)",
      scenario_fallback.patch_count == 2, f"got {scenario_fallback.patch_count}")
check("the fallback write is exactly the original two fields",
      len(scenario_fallback.patch_payloads) == 1
      and set(scenario_fallback.patch_payloads[0]) == {"status", "sent_at"},
      f"got {scenario_fallback.patch_payloads}")

# ---------------------------------------------------------------------------
# 3. Ownership and not-found checks still work — unrelated to this change,
#    confirming the edit didn't regress them.
# ---------------------------------------------------------------------------
scenario_other_coach = Scenario()
_active["scenario"] = scenario_other_coach
app.dependency_overrides[get_current_user] = lambda: "other-coach-id"
response = http_client.post(
    "/email/send", json={"draft_id": DRAFT_ID, "to": "recruiter@acme.example"}
)
check("sending someone else's draft is a 403", response.status_code == 403,
      f"got {response.status_code}")
app.dependency_overrides[get_current_user] = lambda: COACH_ID

email_router.httpx.AsyncClient = _original_async_client  # type: ignore[assignment]
app.dependency_overrides.pop(get_current_user, None)

print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL EMAIL SEND TRACKING TESTS PASSED")
