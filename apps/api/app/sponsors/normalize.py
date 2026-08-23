"""Normalization for sponsor-register matching.

Normalized values exist ONLY to find candidates. Every original GOV.UK value is
stored untouched alongside them — normalization is never allowed to become the
record.

The aim is to absorb the differences that are certainly cosmetic (case,
punctuation, legal suffixes, "and" vs "&") while leaving anything that could
distinguish two real organisations alone. Aggressive normalization is worse than
none here: collapsing "Smith Recruitment" and "Smith Recruitment Group" into one
key would silently merge two employers.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Optional

# Legal / structural suffixes, stripped only from the END of a name. The crawler
# uses the same idea in `app.crawler.normalize`; this list is kept separate
# because the register carries forms the job boards do not (e.g. "C.I.C.").
_LEGAL_SUFFIXES = {
    "ltd", "limited", "llc", "inc", "incorporated", "plc", "llp", "lp",
    "cic", "cio", "co", "company", "corp", "corporation", "gmbh",
    "trust", "partnership",
}

# Expanded rather than stripped: they change what the name refers to.
_AMPERSAND_RE = re.compile(r"\s*&\s*")
# Dropped without leaving a gap, so "C.I.C." collapses to "cic" and "O'Brien"
# to "obrien" rather than fragmenting into single letters.
_JOINING_PUNCT_RE = re.compile(r"[.\u2019']")
_PUNCT_RE = re.compile(r"[^a-z0-9\s]")
_WS_RE = re.compile(r"\s+")


def _fold_accents(text: str) -> str:
    """Strip diacritics so "Ståhl" and "Stahl" share a key.

    The register carries European company names; without folding, the accented
    characters are removed as punctuation and split the word in half.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))

# "Worker (A rating)", "Temporary Worker (A rating)", "Worker (B rating)".
_TYPE_RATING_RE = re.compile(
    r"^\s*(?P<type>.+?)\s*\(\s*(?P<rating>[A-Za-z0-9+\- ]+?)\s*rating\s*\)\s*$",
    re.IGNORECASE,
)


def normalize_organisation_name(name: str) -> str:
    """A lookup key for an organisation name.

    Lowercases, expands `&` to `and`, drops punctuation, collapses whitespace,
    and removes trailing legal suffixes. Returns "" for a name that normalizes
    away entirely, which the caller must treat as unusable rather than as a key.
    """
    if not name:
        return ""
    text = _AMPERSAND_RE.sub(" and ", _fold_accents(name).lower())
    text = _JOINING_PUNCT_RE.sub("", text)
    text = _PUNCT_RE.sub(" ", text)
    words = [w for w in _WS_RE.sub(" ", text).strip().split() if w]
    # Strip suffixes from the end only, and never strip the entire name —
    # "Limited Ltd" must not normalize to nothing.
    while len(words) > 1 and words[-1] in _LEGAL_SUFFIXES:
        words.pop()
    return " ".join(words)


def normalize_town(town: Optional[str]) -> Optional[str]:
    """A lookup key for a town/city, or None when there is nothing to key on."""
    if not town:
        return None
    text = _PUNCT_RE.sub(" ", _fold_accents(town).lower())
    cleaned = _WS_RE.sub(" ", text).strip()
    return cleaned or None


def parse_type_rating(value: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Split "Worker (A rating)" into ("Worker", "A").

    Returns (None, None) when the published value does not follow that shape —
    the register's own wording is kept in `type_rating` either way, so an
    unparsed value loses nothing.
    """
    if not value:
        return None, None
    match = _TYPE_RATING_RE.match(value)
    if not match:
        return None, None
    licence_type = _WS_RE.sub(" ", match.group("type")).strip() or None
    rating = _WS_RE.sub(" ", match.group("rating")).strip().upper() or None
    return licence_type, rating


def natural_key(
    normalized_name: str,
    normalized_town: Optional[str],
    county: Optional[str],
    type_rating: Optional[str],
    route: Optional[str],
) -> str:
    """Stable identity for one register line.

    An organisation appears once per (town, county, type & rating, route), so all
    of those participate. Hashing keeps the unique index narrow and side-steps
    delimiter collisions in free-text fields.
    """
    basis = "|".join(
        [
            normalized_name,
            normalized_town or "",
            (county or "").strip().lower(),
            (type_rating or "").strip().lower(),
            (route or "").strip().lower(),
        ]
    )
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def name_prefix(normalized_name: str, words: int = 2) -> str:
    """The first `words` words of a normalized name, for prefix lookup."""
    return " ".join(normalized_name.split()[:words])
