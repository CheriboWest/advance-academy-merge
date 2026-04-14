"""
Scrape interview questions from five public interview-prep sites.

Usage:
    python3 scripts/research/scrape_interview_questions.py --site hellointerview --limit 50
    python3 scripts/research/scrape_interview_questions.py --site interviewpal
    python3 scripts/research/scrape_interview_questions.py --site muse
    python3 scripts/research/scrape_interview_questions.py --site all --limit 50

Dependencies: stdlib only (urllib, re, html.parser).

Output: one file per site in docs/research/extracted/<site>_questions.txt
(one question per line), plus a combined _all_questions.jsonl with provenance.

Site support:
    - hellointerview : sitemap-based. Fetches each /community/questions/<slug>/<id>
                       page and extracts the <h1>. Fully scrapable (4,200+ Qs).
    - interviewpal   : each page SSRs only ~6 questions. Full DB requires the
                       underlying API (auth-gated). We collect the SSR subset.
    - muse           : single blog post with 65 questions in static HTML.
    - indeed         : Cloudflare-blocks curl/urllib. See NOTES at bottom.
    - resumegenius   : Cloudflare-blocks curl/urllib. See NOTES at bottom.

Politeness: sleeps REQUEST_DELAY_SEC between requests. Set to >= 1.0 unless
you have a good reason. No parallelism.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
import zipfile
from html.parser import HTMLParser
from xml.sax.saxutils import escape as xml_escape

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(REPO_ROOT, "docs", "research", "extracted")
os.makedirs(OUT_DIR, exist_ok=True)

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 "
    "AdvanceAcademyResearchBot/0.1"
)
REQUEST_DELAY_SEC = 1.0
TIMEOUT_SEC = 20


def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        data = resp.read()
    return data.decode("utf-8", errors="ignore")


# ---------- Hello Interview ----------

HI_SITEMAP = "https://www.hellointerview.com/sitemap.xml"
HI_QUESTION_URL_RE = re.compile(
    r"<loc>(https://www\.hellointerview\.com/community/questions/[^<]+)</loc>"
)
# The H1 on each question page carries the full question text.
HI_H1_RE = re.compile(
    r'<h1[^>]*class="[^"]*MuiTypography-h4[^"]*"[^>]*>([^<]+)</h1>',
    re.IGNORECASE,
)
# Fallback: og:title (same string).
HI_OGT_RE = re.compile(
    r'property="og:title"\s+content="([^"]+)"', re.IGNORECASE
)


def hellointerview_urls() -> list[str]:
    xml = http_get(HI_SITEMAP)
    urls = HI_QUESTION_URL_RE.findall(xml)
    # Deduplicate while preserving order.
    seen, out = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def hellointerview_question(url: str) -> str | None:
    html = http_get(url)
    m = HI_H1_RE.search(html) or HI_OGT_RE.search(html)
    return m.group(1).strip() if m else None


def scrape_hellointerview(limit: int | None) -> list[dict]:
    """
    Crash-safe scraper with resume support.

    - Appends every successful fetch to `hellointerview_questions.jsonl`
      immediately (fsync'd), so a kill at any moment leaves all prior
      rows on disk.
    - On startup, loads the existing .jsonl and skips URLs already done.
    - Every CHECKPOINT_EVERY rows, rewrites the final .json + .xlsx so
      those formats stay roughly up-to-date during the run.
    """
    CHECKPOINT_EVERY = 25

    urls = hellointerview_urls()
    print(f"[hellointerview] sitemap lists {len(urls)} question URLs", file=sys.stderr)
    if limit:
        urls = urls[:limit]

    jsonl_path = os.path.join(OUT_DIR, "hellointerview_questions.jsonl")
    # Resume: load any rows we already have.
    out: list[dict] = []
    done_urls: set[str] = set()
    if os.path.exists(jsonl_path):
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                out.append(row)
                done_urls.add(row.get("url", ""))
        print(
            f"[hellointerview] resume: {len(out)} rows already in checkpoint, skipping",
            file=sys.stderr,
        )

    # Open the checkpoint file in append mode for the remainder of the run.
    jsonl_f = open(jsonl_path, "a", encoding="utf-8")

    try:
        for i, url in enumerate(urls, 1):
            if url in done_urls:
                continue
            try:
                q = hellointerview_question(url)
            except Exception as e:
                print(f"  [{i}/{len(urls)}] ERROR {url}: {e}", file=sys.stderr)
                time.sleep(REQUEST_DELAY_SEC)
                continue
            if q:
                row = {"source": "hellointerview", "url": url, "question": q}
                out.append(row)
                done_urls.add(url)
                # Append + fsync: survives kill -9.
                jsonl_f.write(json.dumps(row, ensure_ascii=False) + "\n")
                jsonl_f.flush()
                os.fsync(jsonl_f.fileno())
                if i <= 5 or i % 25 == 0:
                    print(f"  [{i}/{len(urls)}] {q[:80]}", file=sys.stderr)
                # Periodic full-file rewrite of JSON + XLSX.
                if len(out) % CHECKPOINT_EVERY == 0:
                    save("hellointerview", out, quiet=True)
            time.sleep(REQUEST_DELAY_SEC)
    finally:
        jsonl_f.close()

    return out


# ---------- InterviewPal ----------

IP_URL = "https://www.interviewpal.com/questions"
# Escaped-JSON question strings inside the Next.js SSR payload.
IP_QUESTION_RE = re.compile(r'\\"([A-Z][^"\\]{10,300}\?)\\"')


def scrape_interviewpal() -> list[dict]:
    html = http_get(IP_URL)
    qs = sorted(set(IP_QUESTION_RE.findall(html)))
    print(f"[interviewpal] SSR'd questions: {len(qs)} (full DB is ~21k, behind API)", file=sys.stderr)
    return [{"source": "interviewpal", "url": IP_URL, "question": q} for q in qs]


# ---------- The Muse ----------

MUSE_URL = "https://www.themuse.com/advice/interview-questions-and-answers"
# Each question is an <h2>...</h2> in the static HTML. Answer-section
# headers are <h3> ("Possible answer to ..."), so we only take h2s.
MUSE_H2_RE = re.compile(r"<h2[^>]*>(.*?)</h2>", re.DOTALL | re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


def _strip_tags(s: str) -> str:
    return _TAG_RE.sub("", s).strip()


def scrape_muse() -> list[dict]:
    html = http_get(MUSE_URL)
    raw = [_strip_tags(m) for m in MUSE_H2_RE.findall(html)]
    # Drop the article title ("60+ most common...") and any empty/meta headings.
    questions = [
        q for q in raw
        if 15 < len(q) < 300 and not re.match(r"^\d+\+?\s*(most|common)", q, re.IGNORECASE)
    ]
    print(f"[muse] h2={len(raw)}  kept={len(questions)}", file=sys.stderr)
    return [{"source": "muse", "url": MUSE_URL, "question": q} for q in questions]


# ---------- Indeed / ResumeGenius (blocked) ----------

BLOCKED_NOTE = """\
Indeed and ResumeGenius return HTTP 403 to both urllib and curl regardless of
User-Agent. Both sit behind Cloudflare bot protection that fingerprints the TLS
handshake (JA3), not just the UA string. Options:

1. Use a real browser via Playwright:
       pip install playwright && playwright install chromium
   Then open the page, wait for networkidle, and read `document.body.innerText`.
   See scripts/research/scrape_js_sites.md for a sketch.

2. Use a curl-impersonate build
   (https://github.com/lwthiker/curl-impersonate) that mimics Chrome's JA3.

3. Paste the article text manually into a local file and run a regex against it.
   These are editorial articles — content is small and stable.

The Muse covers the same standard interview question set (and more: 65 vs 20
vs 26), so for building a seed bank you can skip Indeed/ResumeGenius without
losing much coverage.
"""


def scrape_indeed() -> list[dict]:
    print("[indeed] blocked (Cloudflare 403). See BLOCKED_NOTE.", file=sys.stderr)
    return []


def scrape_resumegenius() -> list[dict]:
    print("[resumegenius] blocked (Cloudflare 403). See BLOCKED_NOTE.", file=sys.stderr)
    return []


# ---------- Driver ----------

SCRAPERS = {
    "hellointerview": scrape_hellointerview,
    "interviewpal": lambda limit=None: scrape_interviewpal(),
    "muse": lambda limit=None: scrape_muse(),
    "indeed": lambda limit=None: scrape_indeed(),
    "resumegenius": lambda limit=None: scrape_resumegenius(),
}


def _col_letter(idx: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA, etc."""
    s = ""
    n = idx
    while True:
        s = chr(ord("A") + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            break
    return s


def write_xlsx(path: str, headers: list[str], data_rows: list[list[str]]) -> None:
    """Write a minimal valid .xlsx (Office Open XML) using only stdlib."""
    all_rows = [headers] + data_rows
    sheet_rows_xml: list[str] = []
    for r_idx, row in enumerate(all_rows, start=1):
        cells: list[str] = []
        for c_idx, val in enumerate(row):
            col = _col_letter(c_idx)
            txt = xml_escape("" if val is None else str(val))
            cells.append(
                f'<c r="{col}{r_idx}" t="inlineStr">'
                f'<is><t xml:space="preserve">{txt}</t></is></c>'
            )
        sheet_rows_xml.append(f'<row r="{r_idx}">{"".join(cells)}</row>')

    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows_xml)}</sheetData>'
        "</worksheet>"
    )

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Questions" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        "</Relationships>"
    )

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook_xml)
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        z.writestr("xl/worksheets/sheet1.xml", sheet_xml)


def save(site: str, rows: list[dict], quiet: bool = False) -> None:
    """
    Non-fatal save: the .jsonl checkpoint is the source of truth. If either
    rewrite fails (e.g. WSL/NTFS EACCES, file locked by Excel), log a warning
    and keep going — data is not lost.
    """
    json_path = os.path.join(OUT_DIR, f"{site}_questions.json")
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
    except OSError as e:
        print(f"[{site}] WARN: could not rewrite JSON ({e}); .jsonl still current", file=sys.stderr)

    xlsx_path = os.path.join(OUT_DIR, f"{site}_questions.xlsx")
    headers = ["source", "question", "url"]
    data = [[r.get("source", ""), r.get("question", ""), r.get("url", "")] for r in rows]
    try:
        write_xlsx(xlsx_path, headers, data)
    except OSError as e:
        print(f"[{site}] WARN: could not rewrite XLSX ({e}); .jsonl still current", file=sys.stderr)

    if not quiet:
        print(
            f"[{site}] saved {len(rows)} rows -> {json_path} + {xlsx_path}",
            file=sys.stderr,
        )


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--site", choices=list(SCRAPERS) + ["all"], default="all")
    p.add_argument("--limit", type=int, default=None, help="Cap requests per site")
    args = p.parse_args()

    sites = list(SCRAPERS) if args.site == "all" else [args.site]
    total = 0
    for s in sites:
        scraper = SCRAPERS[s]
        try:
            rows = scraper(limit=args.limit) if s == "hellointerview" else scraper()
        except Exception as e:
            print(f"[{s}] FAILED: {e}", file=sys.stderr)
            continue
        save(s, rows)
        total += len(rows)
    print(f"\nTotal questions scraped: {total}", file=sys.stderr)


if __name__ == "__main__":
    main()
