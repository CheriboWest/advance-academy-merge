"""Data models for the sponsor register."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class SponsorRecord:
    """One line of the GOV.UK register, normalized but with originals intact.

    The `organisation_name`/`town_city`/`county`/`type_rating`/`route` fields hold
    exactly what GOV.UK published. `normalized_*` are derived for lookup only.
    """

    organisation_name: str
    town_city: Optional[str]
    county: Optional[str]
    type_rating: Optional[str]
    route: Optional[str]
    licence_type: Optional[str]
    rating: Optional[str]
    normalized_name: str
    normalized_town: Optional[str]
    natural_key: str

    def as_row(self, source_url: str, published_at: Optional[str]) -> dict:
        """The `sponsor_licences` columns this record owns."""
        return {
            "organisation_name": self.organisation_name,
            "town_city": self.town_city,
            "county": self.county,
            "type_rating": self.type_rating,
            "route": self.route,
            "licence_type": self.licence_type,
            "rating": self.rating,
            "normalized_name": self.normalized_name,
            "normalized_town": self.normalized_town,
            "natural_key": self.natural_key,
            "source_url": source_url,
            "register_published_at": published_at,
        }

    def content_fields(self) -> tuple:
        """The fields that decide whether a stored row needs updating."""
        return (
            self.organisation_name,
            self.town_city,
            self.county,
            self.type_rating,
            self.route,
            self.licence_type,
            self.rating,
        )


@dataclass
class RejectedRow:
    """A CSV line that could not be turned into a record, and why."""

    line_number: int
    reason: str
    raw: str = ""


@dataclass
class ImportStats:
    """Statistics for one ingestion run, mirroring sponsor_register_imports."""

    rows_downloaded: int = 0
    rows_parsed: int = 0
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_unchanged: int = 0
    rows_rejected: int = 0
    rows_withdrawn: int = 0
    rejections: list[RejectedRow] = field(default_factory=list)

    def as_columns(self) -> dict[str, int]:
        return {
            "rows_downloaded": self.rows_downloaded,
            "rows_parsed": self.rows_parsed,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "rows_unchanged": self.rows_unchanged,
            "rows_rejected": self.rows_rejected,
            "rows_withdrawn": self.rows_withdrawn,
        }
