"""Self-check for CORS origin rules: `python test_cors.py` (no pytest).

The regex exists so Vercel preview URLs (per-deploy hash) get through. A regex
that is too loose opens the API to any origin and nothing visibly breaks, so
the blocked cases below matter as much as the allowed ones.
"""

from __future__ import annotations

import os

SCOPE_REGEX = r"https://career-hub-[a-z0-9-]+-cheribowests-projects\.vercel\.app"
PRODUCTION = "https://career-hub-web-three.vercel.app"

os.environ["ALLOWED_ORIGINS"] = f"{PRODUCTION},http://localhost:3000"
os.environ["ALLOWED_ORIGIN_REGEX"] = SCOPE_REGEX
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")

from starlette.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402

client = TestClient(create_app())


def allows(origin: str) -> bool:
    response = client.options(
        "/email/send",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    return response.headers.get("access-control-allow-origin") == origin


def demo() -> None:
    for origin in (
        "https://career-hub-3k4ak8ehd-cheribowests-projects.vercel.app",
        "https://career-hub-git-some-branch-cheribowests-projects.vercel.app",
        PRODUCTION,
        "http://localhost:3000",
    ):
        assert allows(origin), f"{origin} should be allowed"

    for origin in (
        # Suffix attack — only safe because Starlette full-matches the regex.
        "https://career-hub-x-cheribowests-projects.vercel.app.evil.com",
        # Another tenant on vercel.app must not inherit our access.
        "https://career-hub-x-someone-elses-projects.vercel.app",
        "http://career-hub-x-cheribowests-projects.vercel.app",  # plain http
        "https://evil.example.com",
    ):
        assert not allows(origin), f"{origin} should be blocked"

    print("cors self-check passed")


if __name__ == "__main__":
    demo()
