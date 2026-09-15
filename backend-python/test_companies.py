"""Self-check for permanent company deletion: `python test_companies.py`.

No pytest, no network, no database: the Supabase RPC call is replaced with a
stub transport, and the coach JWT dependency is overridden, so the endpoint's
own behaviour (auth, validation, error mapping, response shape) is what gets
exercised.
"""

from __future__ import annotations

import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key")

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import get_current_user  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import companies  # noqa: E402

get_settings.cache_clear()

COACH_ID = "aaaaaaaa-0000-0000-0000-00000000000a"
COMPANY_A = "11111111-1111-1111-1111-111111111111"
COMPANY_B = "22222222-2222-2222-2222-222222222222"

FULL_RESULT = {
    "requested": 1,
    "deleted_companies": 1,
    "deleted_company_ids": [COMPANY_A],
    "missing_company_ids": [],
    "deleted_jobs": 3,
    "deleted_coach_meta": 2,
    "unlinked_outreach_emails": 1,
}

_calls: list[dict] = []


class _StubClient:
    """Stands in for `httpx.AsyncClient`, recording the RPC call it receives."""

    responder = None  # set per test: (request) -> httpx.Response

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def post(self, url, headers=None, json=None, **kwargs):
        _calls.append({"url": url, "headers": headers or {}, "json": json})
        request = httpx.Request("POST", url, json=json)
        response = type(self).responder(request)
        response.request = request
        return response


class _StubHttpx:
    """Only what the router touches: the client class and the error types."""

    AsyncClient = _StubClient
    HTTPStatusError = httpx.HTTPStatusError
    HTTPError = httpx.HTTPError


companies.httpx = _StubHttpx  # type: ignore[assignment]

client = TestClient(app)


def _authenticated():
    app.dependency_overrides[get_current_user] = lambda: COACH_ID


def _anonymous():
    app.dependency_overrides.pop(get_current_user, None)


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"PASS  {label}")
    else:
        raise AssertionError(f"FAIL  {label}")


def test_requires_authentication() -> None:
    _anonymous()
    response = client.post("/companies/delete", json={"company_ids": [COMPANY_A]})
    check(response.status_code == 401, "unauthenticated deletion is rejected (401)")
    check(not _calls, "unauthenticated request never reaches the database")


def test_rejects_invalid_ids() -> None:
    _authenticated()
    _calls.clear()

    check(
        client.post("/companies/delete", json={"company_ids": []}).status_code == 422,
        "empty id list is rejected (422)",
    )
    check(
        client.post(
            "/companies/delete", json={"company_ids": ["not-a-uuid"]}
        ).status_code
        == 422,
        "non-UUID id is rejected (422)",
    )
    check(
        client.post(
            "/companies/delete", json={"company_ids": [COMPANY_A] * 201}
        ).status_code
        == 422,
        "over-long bulk request is rejected (422)",
    )
    check(not _calls, "invalid requests never reach the database")


def test_single_deletion() -> None:
    _authenticated()
    _calls.clear()
    _StubClient.responder = lambda request: httpx.Response(200, json=FULL_RESULT)

    response = client.post("/companies/delete", json={"company_ids": [COMPANY_A]})
    check(response.status_code == 200, "single deletion succeeds (200)")

    body = response.json()
    check(body["deleted_companies"] == 1, "single deletion reports one company")
    check(body["deleted_jobs"] == 3, "single deletion reports the deleted jobs")
    check(
        body["deleted_coach_meta"] == 2,
        "single deletion reports coach metadata removed for every coach",
    )
    check(
        body["unlinked_outreach_emails"] == 1,
        "single deletion reports outreach emails unlinked, not deleted",
    )

    call = _calls[-1]
    check(
        call["url"].endswith("/rest/v1/rpc/delete_companies_permanently"),
        "deletion goes through the transactional RPC",
    )
    check(
        call["json"] == {"p_company_ids": [COMPANY_A]},
        "the RPC receives the requested ids",
    )
    check(
        call["headers"].get("apikey") == "service-role-test-key",
        "the RPC is called with the service role key (server-side only)",
    )


def test_bulk_deletion_dedupes_and_reports_partial() -> None:
    _authenticated()
    _calls.clear()
    _StubClient.responder = lambda request: httpx.Response(
        200,
        json={
            "requested": 2,
            "deleted_companies": 1,
            "deleted_company_ids": [COMPANY_A],
            "missing_company_ids": [COMPANY_B],
            "deleted_jobs": 1,
            "deleted_coach_meta": 0,
            "unlinked_outreach_emails": 0,
        },
    )

    response = client.post(
        "/companies/delete",
        json={"company_ids": [COMPANY_A, COMPANY_A, COMPANY_B]},
    )
    check(response.status_code == 200, "bulk deletion succeeds (200)")
    check(
        _calls[-1]["json"] == {"p_company_ids": [COMPANY_A, COMPANY_B]},
        "duplicate ids are collapsed before the database call",
    )

    body = response.json()
    check(
        body["missing_company_ids"] == [COMPANY_B],
        "a partial result names the ids that were not deleted",
    )
    check(
        body["deleted_companies"] + len(body["missing_company_ids"])
        == body["requested"],
        "every requested id is accounted for",
    )


def test_scalar_list_payload_is_accepted() -> None:
    _authenticated()
    _StubClient.responder = lambda request: httpx.Response(200, json=[FULL_RESULT])
    response = client.post("/companies/delete", json={"company_ids": [COMPANY_A]})
    check(
        response.status_code == 200 and response.json()["deleted_companies"] == 1,
        "a single-element RPC payload is unwrapped",
    )


def test_missing_function_is_reported_clearly() -> None:
    _authenticated()
    _StubClient.responder = lambda request: httpx.Response(
        404,
        json={"code": "PGRST202", "message": "Could not find the function"},
    )
    response = client.post("/companies/delete", json={"company_ids": [COMPANY_A]})
    check(response.status_code == 500, "a missing RPC is a server error (500)")
    check(
        "migration" in response.json()["detail"].lower(),
        "a missing RPC points at the migration to apply",
    )


def test_upstream_failure_is_not_reported_as_success() -> None:
    _authenticated()
    _StubClient.responder = lambda request: httpx.Response(
        400, json={"message": "unhandled foreign key reference"}
    )
    response = client.post("/companies/delete", json={"company_ids": [COMPANY_A]})
    check(response.status_code == 502, "a database failure surfaces as 502")
    check(
        "nothing was changed" in response.json()["detail"].lower(),
        "the failure message states that nothing was deleted",
    )


def main() -> None:
    for test in (
        test_requires_authentication,
        test_rejects_invalid_ids,
        test_single_deletion,
        test_bulk_deletion_dedupes_and_reports_partial,
        test_scalar_list_payload_is_accepted,
        test_missing_function_is_reported_clearly,
        test_upstream_failure_is_not_reported_as_success,
    ):
        test()
    _anonymous()
    print("\nAll company deletion checks passed.")


if __name__ == "__main__":
    main()
