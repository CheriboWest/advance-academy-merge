"""Supabase JWT authentication for the API.

Verifies the Supabase access token sent by the frontend as
``Authorization: Bearer <token>`` and exposes ``get_current_user`` as a reusable
FastAPI dependency that returns the authenticated user's id (the ``sub`` claim).
"""

from __future__ import annotations

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


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    """Verify a Supabase access token and return the user id (``sub``).

    Raises 401 if the token is missing, malformed, expired, has a bad signature,
    or was issued by a different Supabase project.
    """
    settings = get_settings()

    if not settings.supabase_jwt_secret:
        # Misconfiguration, not a client error.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server is not configured for authentication.",
        )

    if credentials is None or not credentials.credentials:
        raise _unauthorized("Missing authentication token.")

    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
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
