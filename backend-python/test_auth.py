"""Self-check for JWKS token verification: `python test_auth.py` (no pytest).

Mints ES256 tokens with a throwaway key and serves that key as the project's
JWKS, so the whole verify path runs offline.
"""

from __future__ import annotations

import os
import time
from functools import lru_cache

SUPABASE_URL = "https://example.supabase.co"
os.environ["SUPABASE_URL"] = SUPABASE_URL
# get_current_user is a role gate as well as a token check, so the happy-path
# subject has to be a coach. The allowlist is the path that needs no database.
os.environ["ADMIN_USER_IDS"] = "coach-123"

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from fastapi.security import HTTPAuthorizationCredentials  # noqa: E402
from jose import jwk, jwt  # noqa: E402

from app import auth  # noqa: E402
from app.config import get_settings  # noqa: E402

_real_httpx_get = auth.httpx.get

KID = "test-key-1"


def _keypair() -> tuple[str, dict]:
    private = ec.generate_private_key(ec.SECP256R1())
    pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = (
        private.public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    public_jwk = jwk.construct(public_pem, algorithm="ES256").to_dict()
    return pem, {
        k: (v.decode() if isinstance(v, bytes) else v) for k, v in public_jwk.items()
    }


SIGNING_PEM, PUBLIC_JWK = _keypair()
OTHER_PEM, _ = _keypair()


@lru_cache(maxsize=1)
def _fake_jwks(supabase_url: str) -> dict[str, dict]:
    return {KID: {**PUBLIC_JWK, "kid": KID, "alg": "ES256"}}


auth._jwks = _fake_jwks


def token(pem: str = SIGNING_PEM, kid: str = KID, **claims) -> str:
    payload = {
        "sub": "coach-123",
        "iss": f"{SUPABASE_URL}/auth/v1",
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
        **claims,
    }
    return jwt.encode(payload, pem, algorithm="ES256", headers={"kid": kid})


def call(raw: str | None) -> str:
    creds = (
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=raw) if raw else None
    )
    return auth.get_current_user(creds)


def rejects(raw: str | None, why: str) -> None:
    try:
        call(raw)
    except HTTPException as exc:
        assert exc.status_code == 401, f"{why}: expected 401, got {exc.status_code}"
        return
    raise AssertionError(f"{why}: token was accepted but should not be")


def forbids(raw: str, why: str) -> None:
    """403, not 401 — a good token belonging to someone who is not staff."""
    try:
        call(raw)
    except HTTPException as exc:
        assert exc.status_code == 403, f"{why}: expected 403, got {exc.status_code}"
        return
    raise AssertionError(f"{why}: token was accepted but should not be")


class _FakeResponse:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def raise_for_status(self) -> None:
        pass

    def json(self) -> list[dict]:
        return self._rows


def _serve_users(table: dict[str, bool], calls: list[str]):
    """Stand in for PostgREST's /rest/v1/users, recording each lookup."""

    def fake_get(url: str, **kwargs):
        assert url.endswith("/rest/v1/users"), f"unexpected request to {url}"
        user_id = kwargs["params"]["id"].removeprefix("eq.")
        calls.append(user_id)
        if user_id not in table:
            return _FakeResponse([])
        return _FakeResponse([{"is_admin": table[user_id]}])

    return fake_get


def demo() -> None:
    assert call(token()) == "coach-123", "a valid token should yield its subject"

    rejects(None, "missing token")
    rejects(token(exp=int(time.time()) - 60), "expired token")
    rejects(token(iss="https://attacker.supabase.co/auth/v1"), "foreign issuer")
    rejects(token(pem=OTHER_PEM), "signature from an unknown key")
    rejects(token(kid="not-a-real-kid"), "unknown kid")
    rejects(token(sub=None), "missing subject")

    # --- role gate ---------------------------------------------------------
    # A real, correctly-signed token from someone who is not staff. Before the
    # merge this was accepted: holding a token for this project *was* the proof.
    forbids(token(sub="student-456"), "valid token, not a coach")

    settings = get_settings()
    settings.supabase_service_role_key = "service-role-test-key"
    lookups: list[str] = []
    auth.httpx.get = _serve_users({"db-coach": True, "db-student": False}, lookups)
    try:
        auth._role_cache.clear()

        assert call(token(sub="db-coach")) == "db-coach", "users.is_admin should grant access"
        forbids(token(sub="db-student"), "is_admin false")
        forbids(token(sub="nobody"), "no users row at all")

        # Second call inside the TTL must not hit the database again.
        before = len(lookups)
        call(token(sub="db-coach"))
        assert len(lookups) == before, "a cached role should not be re-read"

        # ...and invalidating it must.
        auth.invalidate_role("db-coach")
        call(token(sub="db-coach"))
        assert len(lookups) == before + 1, "invalidate_role should force a re-read"

        # A lookup failure must fail closed, and must not be cached - otherwise
        # one Supabase blip locks every coach out for the whole TTL.
        auth._role_cache.clear()

        def boom(url: str, **kwargs):
            raise auth.httpx.HTTPError("supabase is down")

        auth.httpx.get = boom
        forbids(token(sub="db-coach"), "lookup failure must fail closed")
        assert "db-coach" not in auth._role_cache, "a failure must not be cached"
    finally:
        auth.httpx.get = _real_httpx_get
        settings.supabase_service_role_key = ""
        auth._role_cache.clear()

    print("auth self-check passed")


if __name__ == "__main__":
    demo()
