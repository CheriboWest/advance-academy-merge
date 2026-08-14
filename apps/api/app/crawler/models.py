"""Shared data models for the crawler."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class NormalizedJob:
    """A job normalized to a source-agnostic shape."""

    source: str
    source_job_id: str
    company_name: str
    title: str
    city: str
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    source_url: Optional[str] = None
    posted_at: Optional[str] = None  # ISO 8601
    location_raw: Optional[str] = None
    website: Optional[str] = None


@dataclass
class CrawlStats:
    """Aggregated statistics for a crawl run."""

    jobs_fetched: int = 0
    new_jobs: int = 0
    duplicate_jobs: int = 0
    companies_discovered: int = 0
    companies_updated: int = 0
    lead_scores_recalculated: int = 0
    source_errors: dict[str, str] = field(default_factory=dict)

    def as_columns(self) -> dict[str, int]:
        return {
            "jobs_fetched": self.jobs_fetched,
            "new_jobs": self.new_jobs,
            "duplicate_jobs": self.duplicate_jobs,
            "companies_discovered": self.companies_discovered,
            "companies_updated": self.companies_updated,
            "lead_scores_recalculated": self.lead_scores_recalculated,
        }
