"""Best-effort company enrichment from a homepage. Never raises."""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urljoin

import httpx

from app.crawler.normalize import strip_html

REQUEST_TIMEOUT = 5.0

_META_DESC_RE = re.compile(
    r"<meta[^>]+name=[\"']description[\"'][^>]*content=[\"']([^\"']+)[\"']",
    re.IGNORECASE,
)
_OG_DESC_RE = re.compile(
    r"<meta[^>]+property=[\"']og:description[\"'][^>]*content=[\"']([^\"']+)[\"']",
    re.IGNORECASE,
)
_FIRST_P_RE = re.compile(r"<p[^>]*>(.*?)</p>", re.IGNORECASE | re.DOTALL)
_CAREERS_RE = re.compile(
    r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>([^<]*)</a>", re.IGNORECASE
)

def _summarise(text: str, max_sentences: int = 3) -> str:
    cleaned = strip_html(text)
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    summary = " ".join(sentences[:max_sentences]).strip()
    return summary[:600]


def _find_careers_url(html: str, base_url: str) -> Optional[str]:
    for href, label in _CAREERS_RE.findall(html):
        haystack = f"{href} {label}".lower()
        if "career" in haystack or "job" in haystack or "vacanc" in haystack:
            if href.startswith("http"):
                return href
            return urljoin(base_url, href)
    return None


async def enrich_company(
    client: httpx.AsyncClient, website: Optional[str]
) -> dict[str, str]:
    """Return best-effort {description, careers_url}. Never raises.

    Sector is no longer guessed here — see app/companies/sector.py."""
    if not website:
        return {}
    try:
        response = await client.get(
            website, timeout=REQUEST_TIMEOUT, follow_redirects=True
        )
        response.raise_for_status()
        html = response.text
    except (httpx.HTTPError, OSError, ValueError):
        return {}

    result: dict[str, str] = {}

    match = _META_DESC_RE.search(html) or _OG_DESC_RE.search(html)
    description = ""
    if match:
        description = strip_html(match.group(1))
    else:
        paragraphs = _FIRST_P_RE.findall(html)
        for paragraph in paragraphs:
            candidate = strip_html(paragraph)
            if len(candidate) > 60:
                description = candidate
                break
    if description:
        result["description"] = _summarise(description)

    careers_url = _find_careers_url(html, website)
    if careers_url:
        result["careers_url"] = careers_url

    return result
