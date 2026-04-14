"""
Scrape every available field from each Hello Interview question page.

Output: docs/research/extracted/hellointerview_full.csv
        docs/research/extracted/hellointerview_full.jsonl  (checkpoint — crash-safe)

Fields per row:
    source                : always "hellointerview"
    url                   : page URL
    question              : the question title (from og:title / <h1>)
    interview_type        : Behavioral | System Design | Coding | ...
    companies             : semicolon-joined list of companies
    total_company_count   : integer from Hello Interview's metadata
    description           : <meta name="description">
    keywords              : <meta name="keywords">
    about                 : "What is this question about" section (narrative)
    also_asked_as         : alternate phrasings listed on the page
    key_insights          : "Key Insights" section (narrative)
    timeline              : "Question Timeline" section (narrative)

Mechanics (same as scrape_interview_questions.py):
    - stdlib only
    - resumable: on startup, reads any existing .jsonl and skips URLs already done
    - crash-safe: every successful fetch is appended + fsync'd to .jsonl
    - periodic CSV rewrite every CHECKPOINT_EVERY rows
    - 1 request/sec default

Usage:
    python3 scripts/research/scrape_hellointerview_full.py
    python3 scripts/research/scrape_hellointerview_full.py --limit 20   # test run
"""

from __future__ import annotations

import argparse
import csv
import html as html_lib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(REPO_ROOT, "docs", "research", "extracted")
os.makedirs(OUT_DIR, exist_ok=True)

JSONL_PATH = os.path.join(OUT_DIR, "hellointerview_full.jsonl")
CSV_PATH = os.path.join(OUT_DIR, "hellointerview_full.csv")
SITEMAP_CACHE = os.path.join(OUT_DIR, ".hellointerview_sitemap.txt")

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 "
    "AdvanceAcademyResearchBot/0.1"
)
REQUEST_DELAY_SEC = 1.0
TIMEOUT_SEC = 20
CHECKPOINT_EVERY = 25
# Per-URL retry on transient network errors.
MAX_RETRIES = 3
# If this many URLs in a row fail, assume the network is down and exit cleanly.
CONSECUTIVE_FAILURE_BAIL = 30

CSV_COLUMNS = [
    "source",
    "url",
    "question",
    "interview_type",
    "companies",
    "total_company_count",
    "description",
    "keywords",
    "about",
    "also_asked_as",
    "key_insights",
    "timeline",
]


# ---------- HTTP ----------

def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        return resp.read().decode("utf-8", errors="ignore")


# Transient network errors worth retrying. HTTP 4xx/5xx propagate through
# HTTPError (a subclass of URLError); we retry only 5xx because 4xx is usually
# permanent (404, 403 etc).
_TRANSIENT = (urllib.error.URLError, TimeoutError, ConnectionError, OSError)


def http_get_with_retry(url: str, max_retries: int = MAX_RETRIES) -> str:
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            return http_get(url)
        except urllib.error.HTTPError as e:
            # 5xx is usually transient; 4xx (404, 403) is not.
            if 500 <= e.code < 600 and attempt < max_retries - 1:
                last_exc = e
                time.sleep(2 ** attempt)
                continue
            raise
        except _TRANSIENT as e:
            last_exc = e
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # 1s, 2s, 4s
                continue
            raise
    # Defensive — unreachable because we either return or raise above.
    raise last_exc if last_exc else RuntimeError("unreachable")


SITEMAP_URL = "https://www.hellointerview.com/sitemap.xml"
QUESTION_URL_RE = re.compile(
    r"<loc>(https://www\.hellointerview\.com/community/questions/[^<]+)</loc>"
)


def _dedupe_preserving_order(items: list[str]) -> list[str]:
    seen, out = set(), []
    for u in items:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def question_urls() -> list[str]:
    """
    Fetch the sitemap and cache the URL list. On network failure, fall back to
    the cached list so a resume run works even if the sitemap fetch itself
    fails. The cache is rewritten on every successful fetch.
    """
    try:
        xml = http_get_with_retry(SITEMAP_URL)
        urls = _dedupe_preserving_order(QUESTION_URL_RE.findall(xml))
        try:
            with open(SITEMAP_CACHE, "w", encoding="utf-8") as f:
                f.write("\n".join(urls))
        except OSError as e:
            print(f"WARN: could not write sitemap cache ({e})", file=sys.stderr)
        return urls
    except Exception as e:
        if os.path.exists(SITEMAP_CACHE):
            print(
                f"WARN: sitemap fetch failed ({e}); using cached list from "
                f"{SITEMAP_CACHE}",
                file=sys.stderr,
            )
            with open(SITEMAP_CACHE, "r", encoding="utf-8") as f:
                return [line.strip() for line in f if line.strip()]
        raise


# ---------- Field extraction ----------

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")
META_RE_TMPL = r'<meta\s+{attr_key}="{attr_val}"\s+content="([^"]*)"'


def _meta(html: str, attr_key: str, attr_val: str) -> str | None:
    pat = META_RE_TMPL.format(attr_key=attr_key, attr_val=re.escape(attr_val))
    m = re.search(pat, html)
    return html_lib.unescape(m.group(1)) if m else None


def _strip(text: str | None) -> str:
    """Unescape first (so entity-encoded tags become real tags), then strip."""
    if not text:
        return ""
    unescaped = html_lib.unescape(text)
    no_tags = TAG_RE.sub(" ", unescaped)
    return WS_RE.sub(" ", no_tags).strip()


_HEADING_CLOSE_RE = re.compile(r"</h[1-6]>", re.IGNORECASE)
_HEADING_OPEN_RE = re.compile(r"<h[1-6][\s>]", re.IGNORECASE)


def _section(html: str, marker: str, max_chars: int = 6000) -> str:
    """
    Text under a section header (which may be wrapped in h2/h3/.../h6 or a
    styled span). Starts from the end of the nearest closing heading tag
    after the marker, and cuts at the next opening heading tag or after
    max_chars, whichever is sooner. Discards any dangling half-tag at the
    truncation point so _strip() always sees balanced markup.
    """
    idx = html.find(marker)
    if idx < 0:
        return ""

    close = _HEADING_CLOSE_RE.search(html, idx)
    start = close.end() if close else idx + len(marker)

    tail = html[start : start + max_chars]

    next_heading = _HEADING_OPEN_RE.search(tail)
    if next_heading:
        tail = tail[: next_heading.start()]

    # Chop any dangling "<tag without-close" at the end so tag-strip can see
    # complete markup.
    last_gt = tail.rfind(">")
    last_lt = tail.rfind("<")
    if last_lt > last_gt:
        tail = tail[:last_lt]

    return _strip(tail)


def _parse_og_payload(html: str) -> dict[str, Any]:
    """
    The og:image URL carries a structured payload:
      ?payload={"props":{"title":"...","companies":[...],
                         "totalCompanyCount":N,"interviewType":"..."},
                "signature":"..."}
    """
    og_image = _meta(html, "property", "og:image")
    if not og_image:
        return {}
    query = urllib.parse.urlparse(og_image).query
    raw = urllib.parse.parse_qs(query).get("payload", [""])[0]
    if not raw:
        return {}
    try:
        return json.loads(raw).get("props", {}) or {}
    except (json.JSONDecodeError, AttributeError):
        return {}


def extract_fields(url: str, html: str) -> dict[str, Any]:
    props = _parse_og_payload(html)
    title = (
        _meta(html, "property", "og:title")
        or props.get("title")
        or ""
    )

    return {
        "source": "hellointerview",
        "url": url,
        "question": title,
        "interview_type": props.get("interviewType", ""),
        "companies": "; ".join(props.get("companies", []) or []),
        "total_company_count": props.get("totalCompanyCount", ""),
        "description": _meta(html, "name", "description") or "",
        "keywords": _meta(html, "name", "keywords") or "",
        "about": _section(html, "What is this question about"),
        "also_asked_as": _section(html, "Also asked as", max_chars=4000),
        "key_insights": _section(html, "Key Insights", max_chars=10000),
        "timeline": _section(html, "Question Timeline", max_chars=4000),
    }


# ---------- IO ----------

def load_checkpoint() -> tuple[list[dict], set[str]]:
    rows: list[dict] = []
    done: set[str] = set()
    if not os.path.exists(JSONL_PATH):
        return rows, done
    with open(JSONL_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            rows.append(r)
            done.add(r.get("url", ""))
    return rows, done


def write_csv(rows: list[dict]) -> None:
    try:
        with open(CSV_PATH, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
            w.writeheader()
            for r in rows:
                w.writerow(r)
    except OSError as e:
        print(f"WARN: could not write CSV ({e}); .jsonl still current", file=sys.stderr)


# ---------- Driver ----------

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None, help="Cap number of questions (for testing)")
    p.add_argument("--delay", type=float, default=REQUEST_DELAY_SEC, help="Seconds between requests")
    args = p.parse_args()

    urls = question_urls()
    print(f"sitemap lists {len(urls)} question URLs", file=sys.stderr)
    if args.limit:
        urls = urls[: args.limit]

    rows, done = load_checkpoint()
    if rows:
        print(f"resume: {len(rows)} rows already in checkpoint", file=sys.stderr)

    jsonl_f = open(JSONL_PATH, "a", encoding="utf-8")
    consecutive_errors = 0
    exit_code = 0
    interrupted = False
    try:
        for i, url in enumerate(urls, 1):
            if url in done:
                continue
            try:
                html = http_get_with_retry(url)
                row = extract_fields(url, html)
            except Exception as e:
                consecutive_errors += 1
                print(
                    f"  [{i}/{len(urls)}] ERROR ({consecutive_errors} in a row) "
                    f"{url}: {e}",
                    file=sys.stderr,
                )
                if consecutive_errors >= CONSECUTIVE_FAILURE_BAIL:
                    print(
                        f"\n{consecutive_errors} consecutive failures — "
                        "assuming the network is down. Exiting cleanly. "
                        "Re-run the script when your connection is back and "
                        "it will resume from where it stopped.",
                        file=sys.stderr,
                    )
                    exit_code = 2
                    break
                time.sleep(args.delay)
                continue
            consecutive_errors = 0
            if not row.get("question"):
                print(f"  [{i}/{len(urls)}] SKIP (no title): {url}", file=sys.stderr)
                time.sleep(args.delay)
                continue
            rows.append(row)
            done.add(url)
            jsonl_f.write(json.dumps(row, ensure_ascii=False) + "\n")
            jsonl_f.flush()
            os.fsync(jsonl_f.fileno())

            if i <= 5 or i % 25 == 0:
                print(f"  [{i}/{len(urls)}] {row['question'][:80]}", file=sys.stderr)
            if len(rows) % CHECKPOINT_EVERY == 0:
                write_csv(rows)
            time.sleep(args.delay)
    except KeyboardInterrupt:
        interrupted = True
        print("\nInterrupted by user. Saving final CSV before exit.", file=sys.stderr)
    finally:
        jsonl_f.close()
        # Always rewrite the CSV on exit (normal completion, bail-out, or Ctrl+C)
        # so the CSV is in sync with the .jsonl.
        write_csv(rows)

    print(f"\nDone. {len(rows)} rows -> {CSV_PATH}", file=sys.stderr)
    if interrupted:
        sys.exit(130)  # conventional exit code for SIGINT
    if exit_code:
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
