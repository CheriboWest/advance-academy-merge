"""Lead scoring — ported from the original outreach tool."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from app.crawler.models import NormalizedJob

_TECHNICAL_KEYWORDS = (
    "engineer",
    "developer",
    "software",
    "data",
    "devops",
    "sre",
    "architect",
    "programmer",
    "machine learning",
    "ml ",
    "backend",
    "frontend",
    "full stack",
    "full-stack",
    "platform",
    "security",
    "cloud",
)


def _is_recent(posted_at: Optional[str], days: int = 7) -> bool:
    if not posted_at:
        return False
    try:
        parsed = datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed >= datetime.now(timezone.utc) - timedelta(days=days)


def _is_technical(title: str) -> bool:
    lowered = title.lower()
    return any(keyword in lowered for keyword in _TECHNICAL_KEYWORDS)


def compute_lead_score(
    jobs: list[NormalizedJob],
    sector: Optional[str] = None,
    company_size: Optional[int] = None,
) -> int:
    """Compute a company's lead score from its active jobs and known attributes.

    - +30 more than 10 active vacancies
    - +20 recent posting within 7 days
    - +15 technology sector
    - +15 company size 50-500 (if available)
    - +20 two or more technical roles
    """
    score = 0

    if len(jobs) > 10:
        score += 30

    if any(_is_recent(job.posted_at) for job in jobs):
        score += 20

    if sector and sector.lower() == "technology":
        score += 15

    if company_size is not None and 50 <= company_size <= 500:
        score += 15

    technical_roles = sum(1 for job in jobs if _is_technical(job.title))
    if technical_roles >= 2:
        score += 20

    return score
