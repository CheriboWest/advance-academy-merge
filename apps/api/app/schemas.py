"""Pydantic request/response models for the API."""

from __future__ import annotations

from typing import Optional
from uuid import UUID

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


# Bulk deletion is one transaction on the database; the cap keeps a single
# request (and the URL-free JSON body it produces) to a sane size.
MAX_COMPANIES_PER_DELETE = 200


class DeleteCompaniesRequest(BaseModel):
    """Companies to permanently delete. Ids are validated as UUIDs by Pydantic."""

    company_ids: list[UUID] = Field(
        ...,
        min_length=1,
        max_length=MAX_COMPANIES_PER_DELETE,
        description="Company ids to delete permanently, for everyone.",
    )


class DeleteCompaniesResponse(BaseModel):
    """Outcome of a permanent deletion, reported per company id.

    `requested` counts the ids after de-duplication, so
    `deleted_companies + len(missing_company_ids) == requested` always holds —
    a partial result is visible rather than implied.
    """

    requested: int
    deleted_companies: int
    deleted_company_ids: list[str] = Field(default_factory=list)
    missing_company_ids: list[str] = Field(default_factory=list)
    deleted_jobs: int = 0
    deleted_coach_meta: int = 0
    unlinked_outreach_emails: int = 0


class SponsorImportResponse(BaseModel):
    """Outcome of one sponsor-register ingestion run."""

    import_id: Optional[str] = None
    status: str
    source_url: Optional[str] = None
    register_published_at: Optional[str] = None
    rows_downloaded: int = 0
    rows_parsed: int = 0
    rows_rejected: int = 0
    rows_processed: int = 0
    rows_current_after: int = 0
    rows_withdrawn: int = 0

    # Deprecated since migration 0009 and always null. Kept so existing clients
    # keep parsing the response; see ImportStats for why they are not computed.
    rows_inserted: Optional[int] = None
    rows_updated: Optional[int] = None
    rows_unchanged: Optional[int] = None


class SponsorCandidate(BaseModel):
    """A register row offered to the resolver."""

    id: str
    organisation_name: str
    town_city: Optional[str] = None
    county: Optional[str] = None
    route: Optional[str] = None
    licence_type: Optional[str] = None
    rating: Optional[str] = None


class SponsorResolutionResponse(BaseModel):
    """The resolution for one company, after the code-side guardrails."""

    company_id: str
    selected_candidate_id: Optional[str] = None
    confidence: float = 0.0
    decision: str
    matched_on: list[str] = Field(default_factory=list)
    reasoning: str = ""
    candidates_considered: int = 0
    search_strategies: list[str] = Field(default_factory=list)
    persisted: bool = False


class SponsorshipMatch(BaseModel):
    """The confirmed sponsor, with sibling licence routes grouped in.

    One legal sponsor is several rows in `sponsor_licences` — one per route.
    `organisation_name`/`town_city`/`county`/`type_rating`/`licence_type`/
    `rating` describe the SPECIFIC row the resolver matched; `routes` lists
    every route currently live for that same organisation at that same
    registered location (grouped by `normalized_name`/`normalized_town`, since
    the register carries no organisation-level id). A sibling route with a
    different `type_rating` is not reflected here — see the endpoint's
    docstring.
    """

    organisation_name: str
    town_city: Optional[str] = None
    county: Optional[str] = None
    type_rating: Optional[str] = None
    licence_type: Optional[str] = None
    rating: Optional[str] = None
    routes: list[str] = Field(default_factory=list)
    confidence: float


class CompanySponsorshipStatus(BaseModel):
    """The coach-facing sponsorship status for one company.

    `status` is one of: licensed | ambiguous | no_match | error | not_checked.

    `licensed` is read from `company_sponsorship_current`, which is always
    current by construction (it joins `sponsor_licences.is_current`, kept live
    by register finalization) — so it needs no separate staleness check.

    The other four states come from `company_sponsorship_checks`, which DOES
    need one: `stale=true` means a check exists but was run against an older
    register edition than `register_import_id` (the current one), so its
    negative/inconclusive conclusion is not trusted as still current. The
    check's own `checked_at`/`candidate_count` are still returned when stale,
    so the UI can show "last checked <date>, against a previous edition"
    rather than nothing at all.

    `error` never carries the underlying exception text — only that a check
    failed.
    """

    company_id: str
    status: str
    checked_at: Optional[str] = None
    register_import_id: Optional[str] = None
    candidate_count: Optional[int] = None
    stale: bool = False
    match: Optional[SponsorshipMatch] = None
