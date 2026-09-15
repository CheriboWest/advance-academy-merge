"""Hiring-signal scoring for companies.

Produces a 0–100 integer stored in ``companies.lead_score`` that expresses how
strongly a company's job data indicates it is *actively hiring right now*. The
score is built from six independent components measuring different aspects of
observable hiring behaviour:

    active_volume_score    0–30   how many active jobs (diminishing returns)
    recent_activity_score  0–25   how many were posted in recent windows
    breadth_score          0–15   how many distinct job functions
    seniority_score        0–10   substantial hiring at senior levels
    momentum_score         0–10   is recent activity increasing vs the prior period
    recency_score          0–10   how fresh the single newest posting is
                           ----
                           100

Design notes / assumptions:

* The only per-job timestamp available on ``NormalizedJob`` is ``posted_at``
  (the source's posting date). ``created_at`` exists only on the persisted DB
  row and is effectively constant across a single bulk-ingested crawl, so it is
  useless for momentum/recency. We therefore use ``posted_at`` as the hiring
  activity time axis. Jobs with a missing/unparseable ``posted_at`` are counted
  towards *volume* but excluded from the time-based signals.
* ``jobs`` is the set of active jobs for one company discovered in the current
  crawl (the pre-existing architecture scores per crawl group, not the full DB
  active set). The score is recomputed whenever fresh job data is ingested.
* No sector / company-size / role-targeting inputs are used — the score is
  purely a function of observable hiring behaviour. ``sector``/``company_size``
  remain in the signature only for backward compatibility with the caller and
  are intentionally ignored.

All thresholds are module-level constants so they can be tuned without touching
the logic.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from app.crawler.models import NormalizedJob

# --------------------------------------------------------------------------
# Component weight caps (sum == 100).
# --------------------------------------------------------------------------
MAX_ACTIVE_VOLUME = 30
MAX_RECENT_ACTIVITY = 25
MAX_BREADTH = 15
MAX_SENIORITY = 10
MAX_MOMENTUM = 10
MAX_RECENCY = 10

# --------------------------------------------------------------------------
# Time windows (days), measured against `posted_at`.
# --------------------------------------------------------------------------
WINDOW_FRESH = 2
WINDOW_RECENT = 7
WINDOW_MID = 14
WINDOW_MONTH = 30
WINDOW_TWO_MONTH = 60
MOMENTUM_PERIOD = 14  # compare the last 14d against the preceding 14d

# --------------------------------------------------------------------------
# Signal 3 — job-function categories, derived conservatively from titles.
# First matching category wins; a title matching nothing is "other" and does
# NOT contribute to breadth (we avoid fabricating precision).
# --------------------------------------------------------------------------
_CATEGORY_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("data_ai", ("data scientist", "data engineer", "machine learning", "ml engineer",
                 "ai engineer", "analytics", "data analyst")),
    ("engineering", ("engineer", "developer", "software", "devops", "sre", "architect",
                     "programmer", "backend", "frontend", "full stack", "full-stack",
                     "platform", "qa ", "technology", "technical")),
    ("finance", ("finance", "financial", "accountant", "accounting", "auditor", "audit",
                 "tax", "treasury", "controller")),
    ("sales", ("sales", "account executive", "business development", "account manager",
               "partnerships")),
    ("marketing", ("marketing", "seo", "content", "brand", "growth", "communications",
                   "social media")),
    ("operations", ("operations", "logistics", "supply chain", "warehouse", "procurement")),
    ("hr", ("recruiter", "recruitment", "talent", "human resources", "hr ", "people ",
            "people operations")),
    ("legal", ("legal", "solicitor", "counsel", "paralegal", "compliance")),
    ("consulting", ("consultant", "consulting", "advisory", "strategy")),
    ("customer_support", ("customer", "support", "success", "service desk", "helpdesk")),
    ("management", ("project manager", "programme manager", "program manager",
                    "product manager", "operations manager", "general manager")),
)

# --------------------------------------------------------------------------
# Signal 4 — seniority tokens, matched on whole words in the TITLE only
# (never the company name). "lead" excludes "leader"; "head" requires "head of".
# --------------------------------------------------------------------------
_SENIORITY_PATTERN = re.compile(
    r"\b(director|vp|vice president|chief|c[te]o|principal|senior|snr|"
    r"head of|manager|lead)\b",
    re.IGNORECASE,
)


def _age_days(posted_at: Optional[str], now: datetime) -> Optional[float]:
    """Age of a posting in days from `now`, or None if missing/unparseable."""
    if not posted_at:
        return None
    try:
        parsed = datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (now - parsed).total_seconds() / 86400.0


def _category_of(title: str) -> Optional[str]:
    """Return a coarse job-function category for a title, or None ("other")."""
    lowered = f" {title.lower()} "
    for category, keywords in _CATEGORY_KEYWORDS:
        if any(keyword in lowered for keyword in keywords):
            return category
    return None


def _is_senior(title: str) -> bool:
    return bool(_SENIORITY_PATTERN.search(title))


# --------------------------------------------------------------------------
# Signal 1 — active job volume (0–30). Diminishing-return threshold ladder:
# more jobs raise the score, but the marginal value shrinks and caps out.
# --------------------------------------------------------------------------
def active_volume_score(jobs: list[NormalizedJob]) -> int:
    n = len(jobs)
    if n <= 0:
        return 0
    if n == 1:
        return 6
    if n == 2:
        return 10
    if n <= 4:
        return 15
    if n <= 9:
        return 22
    if n <= 19:
        return 27
    return MAX_ACTIVE_VOLUME  # 20+


# --------------------------------------------------------------------------
# Signal 2 — recent hiring activity (0–25). A weighted count of jobs posted in
# recent windows: the closer the window, the heavier the weight. Distinct from
# raw volume — old inventory scores 0 here.
# --------------------------------------------------------------------------
def recent_activity_score(jobs: list[NormalizedJob], now: Optional[datetime] = None) -> int:
    now = now or datetime.now(timezone.utc)
    w7 = w14 = w30 = 0
    for job in jobs:
        age = _age_days(job.posted_at, now)
        if age is None or age < 0:
            continue
        if age <= WINDOW_RECENT:
            w7 += 1
        elif age <= WINDOW_MID:
            w14 += 1
        elif age <= WINDOW_MONTH:
            w30 += 1
    weighted = 3 * w7 + 2 * w14 + 1 * w30
    if weighted <= 0:
        return 0
    if weighted <= 2:
        return 6
    if weighted <= 5:
        return 12
    if weighted <= 10:
        return 18
    if weighted <= 20:
        return 22
    return MAX_RECENT_ACTIVITY


# --------------------------------------------------------------------------
# Signal 3 — hiring breadth (0–15). Count of distinct recognised job functions.
# Conservative: unrecognised titles ("other") don't count, so a company posting
# many copies of one role scores low even at high volume.
# --------------------------------------------------------------------------
def breadth_score(jobs: list[NormalizedJob]) -> int:
    categories = {c for c in (_category_of(job.title) for job in jobs) if c is not None}
    d = len(categories)
    if d <= 0:
        return 0
    if d == 1:
        return 3
    if d == 2:
        return 7
    if d == 3:
        return 11
    if d == 4:
        return 13
    return MAX_BREADTH  # 5+


# --------------------------------------------------------------------------
# Signal 4 — seniority of hiring (0–10). Diminishing returns on the *count* of
# senior-titled active roles: substantial senior hiring signals real demand.
# --------------------------------------------------------------------------
def seniority_score(jobs: list[NormalizedJob]) -> int:
    s = sum(1 for job in jobs if _is_senior(job.title))
    if s <= 0:
        return 0
    if s == 1:
        return 3
    if s == 2:
        return 6
    if s <= 4:
        return 8
    return MAX_SENIORITY  # 5+


# --------------------------------------------------------------------------
# Signal 5 — hiring momentum (0–10). Last 14d vs the preceding 14d. Growing
# activity scores above the flat baseline; shrinking scores below; no recent
# activity scores 0. Never contributes a negative amount.
# --------------------------------------------------------------------------
def momentum_score(jobs: list[NormalizedJob], now: Optional[datetime] = None) -> int:
    now = now or datetime.now(timezone.utc)
    recent = previous = 0
    for job in jobs:
        age = _age_days(job.posted_at, now)
        if age is None or age < 0:
            continue
        if age <= MOMENTUM_PERIOD:
            recent += 1
        elif age <= 2 * MOMENTUM_PERIOD:
            previous += 1
    if recent == 0:
        return 0
    total = recent + previous
    # Net change as a fraction of activity, centred on a flat baseline of 5.
    ratio = (recent - previous) / total  # in [-1, 1]
    value = round(5 + 5 * ratio)
    return max(0, min(MAX_MOMENTUM, value))


# --------------------------------------------------------------------------
# Signal 6 — job recency (0–10). Freshness of the single newest active posting,
# independent of how many jobs there are. Distinguishes "30 jobs, newest
# yesterday" from "30 jobs, newest 45 days ago".
# --------------------------------------------------------------------------
def recency_score(jobs: list[NormalizedJob], now: Optional[datetime] = None) -> int:
    now = now or datetime.now(timezone.utc)
    ages = [a for a in (_age_days(job.posted_at, now) for job in jobs)
            if a is not None and a >= 0]
    if not ages:
        return 0
    newest = min(ages)
    if newest <= WINDOW_FRESH:
        return MAX_RECENCY
    if newest <= WINDOW_RECENT:
        return 8
    if newest <= WINDOW_MID:
        return 6
    if newest <= WINDOW_MONTH:
        return 4
    if newest <= WINDOW_TWO_MONTH:
        return 2
    return 0


def compute_lead_score(
    jobs: list[NormalizedJob],
    sector: Optional[str] = None,  # accepted for caller compatibility; unused
    company_size: Optional[int] = None,  # accepted for caller compatibility; unused
    now: Optional[datetime] = None,
) -> int:
    """Compute a company's 0–100 hiring-signal score from its active jobs.

    ``sector`` and ``company_size`` are ignored (kept only so the existing
    caller in the pipeline doesn't need to change). ``now`` is injectable for
    deterministic testing.
    """
    now = now or datetime.now(timezone.utc)
    total = (
        active_volume_score(jobs)
        + recent_activity_score(jobs, now)
        + breadth_score(jobs)
        + seniority_score(jobs)
        + momentum_score(jobs, now)
        + recency_score(jobs, now)
    )
    return max(0, min(100, total))
