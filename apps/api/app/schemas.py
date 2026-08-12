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
