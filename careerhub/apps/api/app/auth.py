"""Supabase JWT authentication for the API.

Verifies the Supabase access token sent by the frontend as
``Authorization: Bearer <token>`` and exposes ``get_current_user`` as a reusable
FastAPI dependency that returns the authenticated user's id (the ``sub`` claim).

The project signs access tokens with asymmetric keys (ES256), so tokens are
verified against the public JWKS the project publishes — there is no shared
secret involved.
"""

from __future__ import annotations

from functools import lru_cache

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTError

from app.config import get_settings

# auto_error=False so we can return our own 401 (with WWW-Authenticate) when the
# Authorization header is missing.
bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHENTICATED_HEADERS = {"WWW-Authenticate": "Bearer"}


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers=_UNAUTHENTICATED_HEADERS,
    )


@lru_cache(maxsize=1)
def _jwks(supabase_url: str) -> dict[str, dict]:
    """Return the project's public signing keys, keyed by ``kid``.

    ponytail: cached for the process lifetime; a rotation is picked up by the
    one cache_clear() retry below. Add a TTL if keys start rotating often.
    """
    response = httpx.get(
        f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json", timeout=10.0
    )
    response.raise_for_status()
    return {key["kid"]: key for key in response.json()["keys"] if key.get("kid")}


def _signing_key(supabase_url: str, kid: str) -> dict | None:
    """Look up ``kid``, refetching once in case the keys were rotated."""
    try:
        key = _jwks(supabase_url).get(kid)
        if key is None:
            _jwks.cache_clear()
            key = _jwks(supabase_url).get(kid)
        return key
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not fetch the token signing keys.",
        ) from exc


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    """Verify a Supabase access token and return the user id (``sub``).

    Raises 401 if the token is missing, malformed, expired, has a bad signature,
    or was issued by a different Supabase project.
    """
    settings = get_settings()

    if not settings.supabase_url:
        # Misconfiguration, not a client error.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server is not configured for authentication.",
        )

    if credentials is None or not credentials.credentials:
        raise _unauthorized("Missing authentication token.")

    token = credentials.credentials

    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except JWTError as exc:
        raise _unauthorized("Invalid authentication token.") from exc

    key = _signing_key(settings.supabase_url, kid) if kid else None
    if key is None:
        raise _unauthorized("Unknown token signing key.")

    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=[key.get("alg", "ES256")],
            # Supabase sets aud="authenticated"; we validate the issuer instead.
            options={"verify_aud": False},
        )
    except ExpiredSignatureError as exc:
        raise _unauthorized("Token has expired.") from exc
    except JWTError as exc:
        raise _unauthorized("Invalid authentication token.") from exc

    # Issuer must reference this Supabase project (e.g.
    # "https://<ref>.supabase.co/auth/v1").
    issuer = str(payload.get("iss", ""))
    if settings.supabase_url and settings.supabase_url not in issuer:
        raise _unauthorized("Invalid token issuer.")

    subject = payload.get("sub")
    if not subject:
        raise _unauthorized("Token is missing a subject claim.")

    return str(subject)
