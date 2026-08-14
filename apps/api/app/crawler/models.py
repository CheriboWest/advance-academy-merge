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
    """Aggregated statistics for a crawl run.

    Identities: raw_jobs = normalized_jobs + duplicate_jobs, and
    normalized_jobs = inserted_jobs + updated_jobs.
    """

    raw_jobs: int = 0
    normalized_jobs: int = 0
    inserted_jobs: int = 0
    updated_jobs: int = 0
    duplicate_jobs: int = 0
    companies_created: int = 0
    companies_updated: int = 0
    source_errors: dict[str, str] = field(default_factory=dict)

    def as_columns(self) -> dict[str, int]:
        return {
            "raw_jobs": self.raw_jobs,
            "normalized_jobs": self.normalized_jobs,
            "inserted_jobs": self.inserted_jobs,
            "updated_jobs": self.updated_jobs,
            "duplicate_jobs": self.duplicate_jobs,
            "companies_created": self.companies_created,
            "companies_updated": self.companies_updated,
        }
