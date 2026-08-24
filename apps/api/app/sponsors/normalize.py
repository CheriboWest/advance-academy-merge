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

# A trailing " rating" inside the brackets, as the older editions wrote it:
# "Worker (A rating)" carries the same grade as today's "Worker (A (Premium))".
_TRAILING_RATING_RE = re.compile(r"\s*rating\s*$", re.IGNORECASE)
# A bare grade — "A", "B", "A+" — is upper-cased so editions that differ only in
# case agree. Anything longer is a phrase GOV.UK wrote, and is left as published.
_BARE_GRADE_RE = re.compile(r"^[A-Za-z][+\-]?$")


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
    """Split the register's "Type & Rating" column into (licence type, rating).

        "Worker (A rating)"                        -> ("Worker", "A")
        "Worker (A (Premium))"                     -> ("Worker", "A (Premium)")
        "Temporary Worker (A (SME+))"              -> ("Temporary Worker", "A (SME+)")
        "Worker (UK Expansion Worker: Provisional )"
                                    -> ("Worker", "UK Expansion Worker: Provisional")

    The current register nests brackets inside the rating, so the split is made
    at the LAST balanced bracket group rather than by a pattern that assumes the
    rating is a single letter followed by the word "rating". A regex written for
    the old wording matched none of the values above and stored two NULLs for
    the whole file.

    Returns (None, None) when the value has no trailing bracket group, or when
    its brackets do not balance — the register's own wording is kept verbatim in
    `type_rating` either way, so an unparsed value loses nothing.
    """
    if not value:
        return None, None
    text = _WS_RE.sub(" ", value).strip()
    if not text.endswith(")"):
        return None, None

    # Walk back from the final ")" to its partner, counting nesting, so the
    # inner brackets of "A (Premium)" do not end the scan early.
    depth = 0
    open_at = -1
    for index in range(len(text) - 1, -1, -1):
        char = text[index]
        if char == ")":
            depth += 1
        elif char == "(":
            depth -= 1
            if depth == 0:
                open_at = index
                break
    if open_at < 0:
        return None, None

    type_part = text[:open_at].strip()
    if type_part.count("(") != type_part.count(")"):
        return None, None  # malformed: an unclosed bracket before the group

    inner = text[open_at + 1 : -1].strip()
    stripped = _TRAILING_RATING_RE.sub("", inner).strip()
    if stripped:
        inner = stripped

    licence_type = type_part or None
    rating = inner.upper() if _BARE_GRADE_RE.match(inner) else (inner or None)
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
