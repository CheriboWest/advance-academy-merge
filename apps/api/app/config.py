"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

# Load a local .env file if present (no-op in production where env vars are set
# by the platform, e.g. Railway).
load_dotenv()

DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000"]


def _parse_origins(raw: str | None) -> list[str]:
    if not raw:
        return list(DEFAULT_ALLOWED_ORIGINS)
    origins = [origin.strip() for origin in raw.split(",")]
    return [origin for origin in origins if origin]


class Settings:
    """Runtime settings for the API.

    The Anthropic API key is read here and never exposed to the frontend — the
    frontend only ever calls this backend.
    """

    def __init__(self) -> None:
        self.anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
        self.anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
        # Request timeout (seconds) for calls to the Anthropic API.
        self.request_timeout: float = float(os.getenv("ANTHROPIC_TIMEOUT", "30"))
        # Comma-separated list of allowed CORS origins (the Vercel frontend).
        self.allowed_origins: list[str] = _parse_origins(os.getenv("ALLOWED_ORIGINS"))
        # Supabase project URL: used to fetch the JWKS that verifies access
        # tokens, and the issuer those tokens must reference.
        self.supabase_url: str = os.getenv("SUPABASE_URL", "")
        # Service role key — server-side only, used to load/update drafts.
        # Never exposed to the frontend.
        self.supabase_service_role_key: str = os.getenv(
            "SUPABASE_SERVICE_ROLE_KEY", ""
        )
        # SMTP (shared Google Workspace mailbox) for sending outreach emails.
        self.smtp_host: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_username: str = os.getenv("SMTP_USERNAME", "")
        self.smtp_password: str = os.getenv("SMTP_PASSWORD", "")
        self.smtp_from: str = os.getenv("SMTP_FROM", "")
        # Job-board crawler credentials.
        self.adzuna_app_id: str = os.getenv("ADZUNA_APP_ID", "")
        self.adzuna_app_key: str = os.getenv("ADZUNA_APP_KEY", "")
        self.reed_api_key: str = os.getenv("REED_API_KEY", "")


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
