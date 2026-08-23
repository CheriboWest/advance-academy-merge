"""Robust parsing of the GOV.UK sponsor-register CSV.

The published file is not a clean machine feed: it has carried a UTF-8 BOM,
Windows-1252 bytes in organisation names, header wording that shifts between
editions ("Town/City" vs "Town / City"), trailing blank lines, and an
occasional short row. Anything unparseable is REJECTED with a reason rather
than silently coerced — a mangled organisation name in a licence register is
worse than a missing one.
"""

from __future__ import annotations

import csv
import io
import re
from typing import Iterable, Iterator, Optional

from app.sponsors.models import RejectedRow, SponsorRecord
from app.sponsors.normalize import (
    natural_key,
    normalize_organisation_name,
    normalize_town,
    parse_type_rating,
)

# Header spellings seen across editions, normalized to our field names. Compared
# after lowercasing and stripping every non-alphanumeric character, so
# "Town/City", "Town / City" and "TOWN/CITY" all collapse to "towncity".
_HEADER_ALIASES: dict[str, str] = {
    "organisationname": "organisation_name",
    "organisation": "organisation_name",
    "name": "organisation_name",
    "towncity": "town_city",
    "town": "town_city",
    "city": "town_city",
    "county": "county",
    "typerating": "type_rating",
    "typeandrating": "type_rating",
    "tierratings": "type_rating",
    "route": "route",
    "subtier": "route",
}

_NON_ALNUM_RE = re.compile(r"[^a-z0-9]")
_WS_RE = re.compile(r"\s+")

# Order matters: the first successful decode wins. GOV.UK has published both
# UTF-8 and Windows-1252; latin-1 never fails, so it is the last resort and
# guarantees we always get *something* to parse rather than an exception.
_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")


class CsvParseError(ValueError):
    """The file could not be parsed as the sponsor register at all."""


def decode(payload: bytes) -> str:
    """Decode the downloaded bytes, tolerating GOV.UK's encoding drift."""
    for encoding in _ENCODINGS:
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    # Unreachable: latin-1 maps every byte. Kept so a future edit to _ENCODINGS
    # cannot silently produce None.
    raise CsvParseError("Could not decode the register file.")


def _header_key(value: str) -> str:
    return _NON_ALNUM_RE.sub("", (value or "").strip().lower())


def _clean(value: Optional[str]) -> Optional[str]:
    """Trim and collapse whitespace, mapping empties to None."""
    if value is None:
        return None
    cleaned = _WS_RE.sub(" ", value.replace(" ", " ")).strip()
    return cleaned or None


def map_headers(header: Iterable[str]) -> dict[str, int]:
    """Map our field names to column indexes, by alias.

    Raises `CsvParseError` when the organisation-name column is absent — without
    it there is no register to import, and guessing a column would be worse than
    failing.
    """
    positions: dict[str, int] = {}
    for index, raw in enumerate(header):
        field = _HEADER_ALIASES.get(_header_key(raw))
        # First occurrence wins, so a duplicated column cannot shift the mapping.
        if field and field not in positions:
            positions[field] = index
    if "organisation_name" not in positions:
        raise CsvParseError(
            "The register file has no recognisable organisation-name column "
            f"(saw: {list(header)[:8]})."
        )
    return positions


def parse_register(
    text: str,
) -> tuple[list[SponsorRecord], list[RejectedRow], int]:
    """Parse the register.

    Returns `(records, rejections, data_line_count)`. `data_line_count` counts
    every non-blank line after the header, so `rows_downloaded` reflects the file
    rather than what survived parsing.
    """
    # GOV.UK has published a preamble line above the header in some editions, so
    # the header is located rather than assumed to be line 1.
    reader = csv.reader(io.StringIO(text))
    rows = [row for row in reader]

    positions: dict[str, int] | None = None
    header_index = -1
    for index, row in enumerate(rows[:10]):
        try:
            positions = map_headers(row)
            header_index = index
            break
        except CsvParseError:
            continue
    if positions is None:
        raise CsvParseError(
            "No header row with an organisation-name column was found in the "
            "first 10 lines of the register file."
        )

    records: list[SponsorRecord] = []
    rejections: list[RejectedRow] = []
    data_lines = 0

    def value(row: list[str], field: str) -> Optional[str]:
        index = positions.get(field)
        if index is None or index >= len(row):
            return None
        return _clean(row[index])

    for offset, row in enumerate(rows[header_index + 1 :], start=header_index + 2):
        if not any((cell or "").strip() for cell in row):
            continue  # trailing or interleaved blank line
        data_lines += 1

        organisation_name = value(row, "organisation_name")
        if not organisation_name:
            rejections.append(
                RejectedRow(offset, "missing organisation name", ",".join(row)[:200])
            )
            continue

        normalized_name = normalize_organisation_name(organisation_name)
        if not normalized_name:
            # A name of only punctuation gives nothing to match on later.
            rejections.append(
                RejectedRow(
                    offset,
                    "organisation name normalizes to empty",
                    organisation_name[:200],
                )
            )
            continue

        town_city = value(row, "town_city")
        county = value(row, "county")
        type_rating = value(row, "type_rating")
        route = value(row, "route")
        licence_type, rating = parse_type_rating(type_rating)
        normalized_town = normalize_town(town_city)

        records.append(
            SponsorRecord(
                organisation_name=organisation_name,
                town_city=town_city,
                county=county,
                type_rating=type_rating,
                route=route,
                licence_type=licence_type,
                rating=rating,
                normalized_name=normalized_name,
                normalized_town=normalized_town,
                natural_key=natural_key(
                    normalized_name, normalized_town, county, type_rating, route
                ),
            )
        )

    return records, rejections, data_lines


def deduplicate(records: list[SponsorRecord]) -> tuple[list[SponsorRecord], int]:
    """Collapse rows that share a natural key within one file.

    The register does repeat lines. Keeping the first occurrence means one
    request cannot carry two rows with the same unique key, which Postgres would
    reject outright.
    """
    seen: set[str] = set()
    unique: list[SponsorRecord] = []
    duplicates = 0
    for record in records:
        if record.natural_key in seen:
            duplicates += 1
            continue
        seen.add(record.natural_key)
        unique.append(record)
    return unique, duplicates
