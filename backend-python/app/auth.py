"""Supabase JWT authentication for the API.

Verifies the Supabase access token sent by the frontend as
``Authorization: Bearer <token>`` and exposes ``get_current_user`` as a reusable
FastAPI dependency that returns the authenticated user's id (the ``sub`` claim).

Since the merge this is also the **role** gate. Every endpoint here is coach
tooling — the crawler, the sponsor register, contacts, outreach — and it now
shares a Supabase project with a student-facing app, so "holds a valid token for
this project" no longer means "is staff". Being the one dependency behind all of
the routers, this is the single place that has to know.

The project signs access tokens with asymmetric keys (ES256), so tokens are
verified against the public JWKS the project publishes — there is no shared
secret involved.
"""

from __future__ import annotations

import time
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


def _forbidden(detail: str) -> HTTPException:
    """403, not 401: the token is valid, the person just isn't staff.

    The distinction matters to the frontend — 401 means "sign in", 403 means
    "signing in again will not help".
    """
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


# user id -> (is_coach, checked_at). Process-local, like the JWKS cache above.
_role_cache: dict[str, tuple[bool, float]] = {}


def _is_coach(user_id: str) -> bool:
    """Whether this user may use the coach API.

    Mirrors AdvanceAcademyTools' lib/admin.ts: the ADMIN_USER_IDS allowlist
    first (the bootstrap path, and the way back in if the flag is ever mis-set),
    then the users.is_admin column.

    Deliberately checks is_admin and NOT users.status. The approval gate answers
    "should this student be let in at all", which is a different question and is
    already enforced by the Node backend on the routes students actually use. A
    coach awaiting approval is a bootstrap problem, not a security one; adding
    status here would lock the first coach out of the workspace they need to
    approve people from.

    Fails closed: any lookup error is "not a coach".
    """
    settings = get_settings()

    if user_id in settings.admin_user_ids:
        return True

    cached = _role_cache.get(user_id)
    now = time.monotonic()
    if cached is not None and now - cached[1] < settings.role_cache_ttl:
        return cached[0]

    if not settings.supabase_url or not settings.supabase_service_role_key:
        return False

    try:
        response = httpx.get(
            f"{settings.supabase_url.rstrip('/')}/rest/v1/users",
            params={"id": f"eq.{user_id}", "select": "is_admin", "limit": "1"},
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
            timeout=10.0,
        )
        response.raise_for_status()
        rows = response.json()
        is_coach = bool(rows and rows[0].get("is_admin"))
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        # Do not cache a failure: a Supabase blip would otherwise lock every
        # coach out for the whole TTL.
        return False

    _role_cache[user_id] = (is_coach, now)
    return is_coach


def invalidate_role(user_id: str) -> None:
    """Drop a cached role so a grant or revoke takes effect immediately."""
    _role_cache.pop(user_id, None)


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
    or was issued by a different Supabase project — and 403 if it is a perfectly
    good token belonging to someone who is not a coach.
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

    user_id = str(subject)

    # The token is genuine; the remaining question is whether this person is
    # staff. Before the merge every token holder was, because only coaches had
    # accounts in this project.
    if not _is_coach(user_id):
        raise _forbidden("This account does not have coach access.")

    return user_id
