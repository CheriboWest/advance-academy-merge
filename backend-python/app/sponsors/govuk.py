"""Locating and downloading the current register CSV from GOV.UK.

GOV.UK does not publish a stable CSV URL: each edition is uploaded to
`assets.publishing.service.gov.uk` under a dated path, and the publication page
links to whichever is current. So the importer reads the publication page, finds
the CSV attachment, and downloads that — which is also how it picks up a new
edition without a code change.

The page is HTML, and scraping it is inherently brittle. Two things reduce the
blast radius: the CSV link is looked for in several ways before giving up, and
the resolved URL is stored on every row so a bad edition can be traced.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Optional

import httpx

PUBLICATION_URL = (
    "https://www.gov.uk/government/publications/"
    "register-of-licensed-sponsors-workers"
)

# GOV.UK exposes a JSON representation of every page. It is far more stable than
# the rendered HTML, so it is tried first and the HTML scrape is the fallback.
CONTENT_API_URL = (
    "https://www.gov.uk/api/content/government/publications/"
    "register-of-licensed-sponsors-workers"
)

REQUEST_TIMEOUT = 60.0
# The register is a few MB of CSV; anything far larger is not the file we want.
MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024

_CSV_HREF_RE = re.compile(
    r'href="(?P<url>https://assets\.publishing\.service\.gov\.uk/[^"]+?\.csv)"',
    re.IGNORECASE,
)
_ANY_CSV_RE = re.compile(
    r'"(?P<url>https://[^"\s]+?\.csv)"', re.IGNORECASE
)
_DATE_IN_URL_RE = re.compile(r"/(?P<year>20\d{2})-(?P<month>\d{2})-(?P<day>\d{2})/")


class RegisterUnavailableError(RuntimeError):
    """The current register CSV could not be located or downloaded."""


@dataclass(frozen=True)
class RegisterSource:
    """A located register file: where it came from and when it was published."""

    csv_url: str
    published_at: Optional[date]
    discovered_from: str


def _published_date(url: str, fallback: Optional[str] = None) -> Optional[date]:
    """The edition date, taken from the asset URL and then from page metadata."""
    match = _DATE_IN_URL_RE.search(url)
    if match:
        try:
            return date(
                int(match.group("year")), int(match.group("month")), int(match.group("day"))
            )
        except ValueError:
            pass
    if fallback:
        try:
            return date.fromisoformat(fallback[:10])
        except ValueError:
            return None
    return None


def _from_content_api(payload: dict) -> Optional[RegisterSource]:
    """Find the CSV attachment in GOV.UK's content API payload."""
    details = payload.get("details") or {}
    attachments = details.get("attachments") or []
    updated = payload.get("public_updated_at") or payload.get("updated_at")

    for attachment in attachments:
        url = attachment.get("url") or ""
        content_type = (attachment.get("content_type") or "").lower()
        if url.lower().endswith(".csv") or "csv" in content_type:
            return RegisterSource(
                csv_url=url,
                published_at=_published_date(url, updated),
                discovered_from="content-api",
            )
    return None


def _from_html(html: str) -> Optional[RegisterSource]:
    """Find the CSV attachment by scraping the rendered publication page."""
    match = _CSV_HREF_RE.search(html) or _ANY_CSV_RE.search(html)
    if not match:
        return None
    url = match.group("url")
    return RegisterSource(
        csv_url=url, published_at=_published_date(url), discovered_from="html"
    )


async def find_current_csv(client: httpx.AsyncClient) -> RegisterSource:
    """Locate the current register CSV.

    Tries GOV.UK's content API first, then the rendered page. Raises
    `RegisterUnavailableError` when neither yields a CSV link, rather than
    falling back to a hardcoded URL that would silently go stale.
    """
    errors: list[str] = []

    try:
        response = await client.get(CONTENT_API_URL, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        source = _from_content_api(response.json())
        if source:
            return source
        errors.append("content API returned no CSV attachment")
    except (httpx.HTTPError, ValueError) as exc:
        errors.append(f"content API unavailable ({type(exc).__name__})")

    try:
        response = await client.get(
            PUBLICATION_URL, timeout=REQUEST_TIMEOUT, follow_redirects=True
        )
        response.raise_for_status()
        source = _from_html(response.text)
        if source:
            return source
        errors.append("publication page contained no CSV link")
    except httpx.HTTPError as exc:
        errors.append(f"publication page unavailable ({type(exc).__name__})")

    raise RegisterUnavailableError(
        "Could not locate the current register CSV on GOV.UK: " + "; ".join(errors)
    )


async def download_csv(client: httpx.AsyncClient, url: str) -> bytes:
    """Download the register CSV, refusing an implausibly large response."""
    try:
        response = await client.get(url, timeout=REQUEST_TIMEOUT, follow_redirects=True)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise RegisterUnavailableError(
            f"Could not download the register CSV ({type(exc).__name__})."
        ) from exc

    payload = response.content
    if len(payload) > MAX_DOWNLOAD_BYTES:
        raise RegisterUnavailableError(
            f"The register file is larger than expected ({len(payload)} bytes)."
        )
    if not payload:
        raise RegisterUnavailableError("The register file was empty.")
    return payload
