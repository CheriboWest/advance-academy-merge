"""Pydantic request/response models for the API."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class OutreachRequest(BaseModel):
    """Company context used to generate an outreach email."""

    company_name: str = Field(..., min_length=1, description="Company name.")
    location: Optional[str] = Field(None, description="Company location, if known.")
    sector: Optional[str] = Field(None, description="Company sector, if known.")
    open_jobs: int = Field(0, ge=0, description="Number of open jobs.")
    lead_score: int = Field(0, description="Outreach lead score (0–100).")


class OutreachResponse(BaseModel):
    """Generated outreach email."""

    subject: str
    body: str


class SendEmailRequest(BaseModel):
    """Request to send a saved outreach draft to a recipient."""

    draft_id: str = Field(..., min_length=1, description="outreach_emails row id.")
    to: str = Field(..., min_length=3, description="Recipient email address.")


class SendEmailResponse(BaseModel):
    """Result of sending an outreach email."""

    status: str
    sent_at: str
    recipient_email: str


class DiscoverStartRequest(BaseModel):
    """Request to start (or check the cache for) a crawl."""

    query: str = Field(..., min_length=1, description="Role / keyword.")
    city: str = Field(..., min_length=1, description="City.")
    sources: list[str] = Field(default_factory=lambda: ["adzuna", "reed"])
    force: bool = Field(False, description="Bypass the 24h cache and refresh now.")


class DiscoverStartResponse(BaseModel):
    """Either a cache hit (no crawl started) or a started run."""

    cached: bool
    run_id: Optional[str] = None
    status: Optional[str] = None
    last_refreshed_at: Optional[str] = None
    hours_ago: Optional[float] = None
    jobs_available: Optional[int] = None


class CrawlRunStatus(BaseModel):
    """A crawl run row + its statistics."""

    id: str
    status: str
    query: Optional[str] = None
    location: Optional[str] = None
    raw_jobs: int = 0
    normalized_jobs: int = 0
    inserted_jobs: int = 0
    updated_jobs: int = 0
    duplicate_jobs: int = 0
    companies_created: int = 0
    companies_updated: int = 0
    error: Optional[str] = None
    created_at: Optional[str] = None
    finished_at: Optional[str] = None
