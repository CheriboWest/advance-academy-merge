"""Self-check for pre-import validation and withdrawal safety.

`python test_sponsor_validation.py` — offline.

The failure this guards against is not a file that won't parse; that raises and
writes nothing. It is a file that parses successfully into the WRONG SHAPE — a
renamed column, a truncated download — which would import a handful of rows and
withdraw the rest of the register. Every check below is about refusing that
before a single register row is touched.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from app.sponsors.importer import RegisterValidationError, run_import
from app.sponsors.parser import (
    CsvParseError,
    decode_detail,
    deduplicate,
    parse_register_detail,
)
from app.sponsors.validation import (
    MAX_REJECTION_RATE,
    MAX_SHRINK_RATE,
    build_report,
    render,
)
from test_sponsor_register import FakeRest

FIXTURE = Path(__file__).parent / "tests" / "fixtures" / "sponsor_register_sample.csv"
HEADER = "Organisation Name,Town/City,County,Type & Rating,Route\n"

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


def clean_csv(rows: int, *, route: str = "Skilled Worker", prefix: str = "Org") -> bytes:
    body = "".join(
        f"{prefix} {i} Ltd,London,Greater London,Worker (A rating),{route}\n"
        for i in range(rows)
    )
    return (HEADER + body).encode("utf-8")


def report_for(payload: bytes, previous: int | None = None):
    text, encoding = decode_detail(payload)
    parsed = parse_register_detail(text)
    records, duplicates = deduplicate(parsed.records)
    return build_report(
        file_name="test.csv", encoding=encoding, header_line=parsed.header_line,
        header_row=parsed.header_row, column_map=parsed.column_map,
        records=records, rejections=parsed.rejections,
        data_lines=parsed.data_lines, duplicates=duplicates,
        previous_rows_parsed=previous,
    )


def ingest(rest: FakeRest, payload: bytes, force: bool = False):
    return asyncio.run(
        run_import(rest, client=object(), csv_bytes=payload,
                   source_url="test.csv", force=force)
    )


# ---------------------------------------------------------------------------
# The report describes the file accurately.
# ---------------------------------------------------------------------------
report = report_for(FIXTURE.read_bytes())
check("report names the encoding", report.encoding == "utf-8-sig", report.encoding)
check("report locates the header row", report.header_line == 1)
check("report maps every expected column",
      set(report.column_map) == {"organisation_name", "town_city", "county",
                                 "type_rating", "route"},
      f"got {report.column_map}")
check("report shows the SOURCE column each field came from",
      report.column_map["type_rating"] == "Type & Rating")
check("report counts rows read, parsed and rejected",
      (report.rows_read, report.rows_parsed, report.rows_rejected) == (10, 8, 2),
      f"got {(report.rows_read, report.rows_parsed, report.rows_rejected)}")
check("report counts duplicate natural keys", report.duplicate_natural_keys == 1)
check("report counts unique organisations", report.unique_organisations == 7,
      f"got {report.unique_organisations}")
check("report lists distinct routes", len(report.distinct_routes) == 3)
check("report lists distinct type/rating values", len(report.distinct_type_ratings) == 3)
check("report carries 5 samples", len(report.samples) == 5)
check("report carries up to 10 rejections with reasons",
      len(report.rejections) == 1 and report.rejections[0].reason)
rendered = render(report)
check("rendered report includes the mapped columns", "Organisation Name" in rendered)
check("rendered report states the outcome", "RESULT:" in rendered)

# ---------------------------------------------------------------------------
# A file that parses into the wrong shape is refused.
# ---------------------------------------------------------------------------
check("a clean file passes", report_for(clean_csv(500)).ok)

missing_route = (HEADER + "Org A Ltd,London,Greater London,Worker (A rating),\n").encode()
r = report_for(missing_route)
check("a row with no route fails validation", not r.ok)
check("the failure names the missing route",
      any("route" in f for f in r.failures), f"got {r.failures}")

bad_rows = "".join(",London,GL,Worker (A rating),Skilled Worker\n" for _ in range(20))
r = report_for((HEADER + clean_csv(100).decode().split("\n", 1)[1] + bad_rows).encode())
check(f"a rejection rate above {MAX_REJECTION_RATE:.0%} fails validation", not r.ok)
check("the failure names the rejection rate",
      any("Rejection rate" in f for f in r.failures), f"got {r.failures}")

r = report_for(HEADER.encode())
check("a file with zero parsed rows fails validation", not r.ok)
check("the failure explains the withdrawal consequence",
      any("withdrawn" in f for f in r.failures), f"got {r.failures}")

# ---------------------------------------------------------------------------
# Edition sanity: a sudden shrink is refused.
# ---------------------------------------------------------------------------
r = report_for(clean_csv(1000), previous=1000)
check("an unchanged edition passes", r.ok and abs(r.change_vs_previous) < 0.001)
r = report_for(clean_csv(980), previous=1000)
check("a small decrease passes", r.ok, f"got {r.failures}")
r = report_for(clean_csv(500), previous=1000)
check(f"a drop beyond {MAX_SHRINK_RATE:.0%} fails validation", not r.ok)
check("the failure quotes both counts",
      any("500" in f and "1000" in f for f in r.failures), f"got {r.failures}")
check("the failure explains what importing would do",
      any("withdraw" in f for f in r.failures))
r = report_for(clean_csv(2000), previous=1000)
check("growth is never refused", r.ok, f"got {r.failures}")

# ---------------------------------------------------------------------------
# The gate stops the import BEFORE the register is touched.
# ---------------------------------------------------------------------------
rest = FakeRest()
ingest(rest, clean_csv(100), force=True)
before = [dict(row) for row in rest.rows]
check("a good edition is stored", len(before) == 100)

try:
    ingest(rest, clean_csv(10))          # a 90% drop
    refused = False
except RegisterValidationError:
    refused = True
check("a shrunken edition is REFUSED", refused)
check("WITHDRAWAL SAFETY: no row was withdrawn", all(r["is_current"] for r in rest.rows))
check("WITHDRAWAL SAFETY: the stored register is unchanged",
      len(rest.rows) == 100 and rest.rows == before)
check("the refusal is recorded as a failed import run",
      rest.imports[-1]["status"] == "error"
      and "Rejection" in (rest.imports[-1].get("error") or "")
      or "fewer rows" in (rest.imports[-1].get("error") or ""),
      f"got {rest.imports[-1].get('error')}")

try:
    ingest(rest, HEADER.encode())        # zero rows — the catastrophic case
    refused_empty = False
except RegisterValidationError:
    refused_empty = True
check("an empty edition is REFUSED", refused_empty)
check("WITHDRAWAL SAFETY: an empty edition withdraws nothing",
      len(rest.rows) == 100 and all(r["is_current"] for r in rest.rows))

# --force is the deliberate override.
_, stats = ingest(rest, clean_csv(10), force=True)
check("--force imports a genuinely smaller edition", stats.rows_parsed == 10)
check("--force does then withdraw the missing rows", stats.rows_withdrawn == 90,
      f"got {stats.rows_withdrawn}")
check("withdrawn rows are kept, not deleted", len(rest.rows) == 100)

# ---------------------------------------------------------------------------
# An unparseable schema is loud, and never reaches the register.
# ---------------------------------------------------------------------------
rest2 = FakeRest()
ingest(rest2, clean_csv(50), force=True)
try:
    ingest(rest2, b"Employer,Place\nAcme,London\n")
    raised = None
except CsvParseError as exc:
    raised = str(exc)
check("an unrecognised schema raises CsvParseError", raised is not None)
check("the message says the schema is unrecognised",
      "Unrecognised sponsor-register CSV schema" in (raised or ""))
check("the message lists the columns it actually saw",
      "Employer" in (raised or ""), f"got {raised}")
check("the message lists the expected fields",
      all(f in (raised or "") for f in
          ("organisation_name", "town_city", "county", "type_rating", "route")))
check("WITHDRAWAL SAFETY: an unparseable file withdraws nothing",
      len(rest2.rows) == 50 and all(r["is_current"] for r in rest2.rows))

print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL SPONSOR VALIDATION TESTS PASSED")
