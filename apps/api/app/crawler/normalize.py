"""Normalization helpers: company slugs, titles, cities, and content hashing."""

from __future__ import annotations

import hashlib
import re

# Legal / structural suffixes stripped when deriving a company slug, so that
# "8th Light Ltd", "8th Light" and "8th-Light" all collapse to "8th-light".
_LEGAL_SUFFIXES = {
    "ltd",
    "limited",
    "llc",
    "inc",
    "incorporated",
    "plc",
    "llp",
    "co",
    "company",
    "corp",
    "corporation",
    "gmbh",
    "group",
    "holdings",
    "uk",
}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def strip_html(text: str) -> str:
    return _WS_RE.sub(" ", _TAG_RE.sub(" ", text)).strip()


def _company_words(name: str) -> list[str]:
    text = strip_html(name).lower()
    text = re.sub(r"[.,&/]", " ", text)
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = text.replace("-", " ")
    words = [w for w in text.split() if w]
    # Drop trailing legal suffixes (possibly more than one).
    while words and words[-1] in _LEGAL_SUFFIXES:
        words.pop()
    return words


def company_slug(name: str) -> str:
    """Derive a canonical slug for a company display name."""
    words = _company_words(name)
    slug = "-".join(words)
    if slug:
        return slug
    fallback = re.sub(r"[^a-z0-9]+", "-", strip_html(name).lower()).strip("-")
    return fallback or "company"


def canonical_company_name(name: str) -> str:
    """A cleaned display name (HTML stripped, whitespace collapsed)."""
    return strip_html(name)


def normalize_title(title: str) -> str:
    return _WS_RE.sub(" ", strip_html(title)).strip()


def normalize_city(city: str) -> str:
    cleaned = strip_html(city).strip()
    # Adzuna returns "London, South East England" style strings.
    first = cleaned.split(",")[0].strip()
    return first or cleaned


def normalize_query(text: str) -> str:
    return _WS_RE.sub(" ", text).strip().lower()


def content_hash(company_slug_value: str, title: str, city: str) -> str:
    """Content-based dedup hash: same role at same company/city → same hash.

    Deduplicates re-crawls and the same role appearing across sources.
    """
    basis = "|".join(
        [
            company_slug_value,
            normalize_title(title).lower(),
            normalize_city(city).lower(),
        ]
    )
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()
