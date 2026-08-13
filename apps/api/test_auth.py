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

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from fastapi.security import HTTPAuthorizationCredentials  # noqa: E402
from jose import jwk, jwt  # noqa: E402

from app import auth  # noqa: E402

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


def demo() -> None:
    assert call(token()) == "coach-123", "a valid token should yield its subject"

    rejects(None, "missing token")
    rejects(token(exp=int(time.time()) - 60), "expired token")
    rejects(token(iss="https://attacker.supabase.co/auth/v1"), "foreign issuer")
    rejects(token(pem=OTHER_PEM), "signature from an unknown key")
    rejects(token(kid="not-a-real-kid"), "unknown kid")
    rejects(token(sub=None), "missing subject")

    print("auth self-check passed")


if __name__ == "__main__":
    demo()
