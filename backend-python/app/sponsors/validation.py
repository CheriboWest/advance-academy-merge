"""Pre-import validation of a sponsor-register file.

The danger this guards against is not a file that fails to parse — that raises
loudly and writes nothing. It is a file that parses *successfully into the wrong
shape*: GOV.UK renames a column, most rows lose their organisation name, the
import "succeeds" with 400 rows instead of 60,000, and the withdrawal step marks
every real licence as no longer current.

So the checks below run against the parsed result BEFORE any register row is
written, and any failure aborts the import with nothing changed. `--force`
overrides them for the case where GOV.UK genuinely did publish a much smaller
edition and a human has looked at it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.sponsors.models import RejectedRow, SponsorRecord

# Above this share of unparseable lines, assume the format changed rather than
# that the Home Office published thousands of malformed rows.
MAX_REJECTION_RATE = 0.02
# A genuine edition-to-edition change is a percent or two. A fifth of the
# register disappearing is a format change until proven otherwise.
MAX_SHRINK_RATE = 0.20


@dataclass
class ValidationReport:
    """What one file looks like, and whether it is safe to import."""

    file_name: str = ""
    encoding: str = ""
    header_line: int = 0
    header_row: list[str] = field(default_factory=list)
    column_map: dict[str, str] = field(default_factory=dict)

    rows_read: int = 0
    rows_parsed: int = 0
    rows_rejected: int = 0
    duplicate_natural_keys: int = 0

    unique_organisations: int = 0
    distinct_routes: list[str] = field(default_factory=list)
    distinct_type_ratings: list[str] = field(default_factory=list)
    rows_missing_route: int = 0
    rows_missing_organisation: int = 0

    previous_rows_parsed: Optional[int] = None
    change_vs_previous: Optional[float] = None

    samples: list[SponsorRecord] = field(default_factory=list)
    rejections: list[RejectedRow] = field(default_factory=list)

    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def rejection_rate(self) -> float:
        return self.rows_rejected / self.rows_read if self.rows_read else 0.0

    @property
    def ok(self) -> bool:
        return not self.failures


def build_report(
    *,
    file_name: str,
    encoding: str,
    header_line: int,
    header_row: list[str],
    column_map: dict[str, str],
    records: list[SponsorRecord],
    rejections: list[RejectedRow],
    data_lines: int,
    duplicates: int,
    previous_rows_parsed: Optional[int] = None,
) -> ValidationReport:
    """Describe the file and decide whether it may be imported."""
    report = ValidationReport(
        file_name=file_name,
        encoding=encoding,
        header_line=header_line,
        header_row=header_row,
        column_map=column_map,
        rows_read=data_lines,
        rows_parsed=len(records),
        rows_rejected=len(rejections) + duplicates,
        duplicate_natural_keys=duplicates,
        unique_organisations=len({r.normalized_name for r in records}),
        distinct_routes=sorted({r.route for r in records if r.route}),
        distinct_type_ratings=sorted({r.type_rating for r in records if r.type_rating}),
        rows_missing_route=sum(1 for r in records if not r.route),
        rows_missing_organisation=sum(1 for r in records if not r.organisation_name),
        previous_rows_parsed=previous_rows_parsed,
        samples=records[:5],
        rejections=rejections[:10],
    )

    if previous_rows_parsed:
        report.change_vs_previous = (
            len(records) - previous_rows_parsed
        ) / previous_rows_parsed

    # --- conditions that abort the import --------------------------------
    if report.rows_parsed == 0:
        report.failures.append(
            "No rows parsed. Nothing would be imported, and every stored "
            "licence would be marked withdrawn."
        )

    if report.rows_missing_organisation:
        report.failures.append(
            f"{report.rows_missing_organisation} accepted rows have no "
            "organisation name."
        )

    if report.rows_missing_route:
        report.failures.append(
            f"{report.rows_missing_route} accepted rows have no route. Every "
            "register line carries one, so a column has probably moved."
        )

    if report.rejection_rate > MAX_REJECTION_RATE:
        report.failures.append(
            f"Rejection rate {report.rejection_rate:.1%} exceeds "
            f"{MAX_REJECTION_RATE:.0%}. The file's shape has probably changed."
        )

    if (
        report.change_vs_previous is not None
        and report.change_vs_previous < -MAX_SHRINK_RATE
    ):
        report.failures.append(
            f"This edition has {abs(report.change_vs_previous):.1%} fewer rows "
            f"than the last successful import ({report.rows_parsed} vs "
            f"{report.previous_rows_parsed}), beyond the "
            f"{MAX_SHRINK_RATE:.0%} limit. Importing would withdraw the "
            "difference."
        )

    # --- worth saying, but not worth stopping for -------------------------
    if report.rejections:
        report.warnings.append(f"{report.rows_rejected} rows were rejected.")
    if report.duplicate_natural_keys:
        report.warnings.append(
            f"{report.duplicate_natural_keys} repeated register lines were "
            "collapsed."
        )
    if report.encoding not in {"utf-8-sig", "utf-8"}:
        report.warnings.append(
            f"Decoded as {report.encoding}; GOV.UK normally publishes UTF-8."
        )
    if (
        report.change_vs_previous is not None
        and abs(report.change_vs_previous) > 0.05
    ):
        report.warnings.append(
            f"Row count changed by {report.change_vs_previous:+.1%} against the "
            "previous edition."
        )

    return report


def render(report: ValidationReport, *, forced: bool = False) -> str:
    """The human-readable validation report."""
    lines = [
        "Sponsor register validation",
        "=" * 64,
        f"  file                  {report.file_name}",
        f"  encoding              {report.encoding}",
        f"  header line           {report.header_line}",
        f"  header row            {report.header_row}",
        "  mapped columns",
    ]
    for field_name in (
        "organisation_name", "town_city", "county", "type_rating", "route"
    ):
        source = report.column_map.get(field_name)
        lines.append(
            f"      {field_name:<18} <- "
            + (f"{source!r}" if source else "(not present in this file)")
        )

    lines += [
        "",
        f"  rows read             {report.rows_read}",
        f"  rows parsed           {report.rows_parsed}",
        f"  rows rejected         {report.rows_rejected} "
        f"({report.rejection_rate:.2%})",
        f"  duplicate keys        {report.duplicate_natural_keys}",
        f"  unique organisations  {report.unique_organisations}",
        f"  rows missing route    {report.rows_missing_route}",
    ]

    if report.previous_rows_parsed is not None:
        lines.append(
            f"  previous edition      {report.previous_rows_parsed} rows "
            f"({report.change_vs_previous:+.1%})"
        )

    lines += ["", f"  distinct routes ({len(report.distinct_routes)})"]
    lines += [f"      {route}" for route in report.distinct_routes[:20]]
    if len(report.distinct_routes) > 20:
        lines.append(f"      … and {len(report.distinct_routes) - 20} more")

    lines += ["", f"  distinct type & rating ({len(report.distinct_type_ratings)})"]
    lines += [f"      {value}" for value in report.distinct_type_ratings[:20]]
    if len(report.distinct_type_ratings) > 20:
        lines.append(f"      … and {len(report.distinct_type_ratings) - 20} more")

    lines += ["", "  sample records"]
    for record in report.samples:
        lines.append(
            f"      {record.organisation_name} | {record.town_city or '-'} | "
            f"{record.county or '-'} | {record.type_rating or '-'} | "
            f"{record.route or '-'}"
        )
        lines.append(f"        normalized: {record.normalized_name!r}")

    if report.rejections:
        lines += ["", "  first rejected rows"]
        for rejected in report.rejections:
            lines.append(
                f"      line {rejected.line_number}: {rejected.reason}"
            )
            if rejected.raw:
                lines.append(f"        {rejected.raw[:120]}")

    if report.warnings:
        lines += ["", "  warnings"]
        lines += [f"      - {warning}" for warning in report.warnings]

    lines.append("")
    if report.ok:
        lines.append("  RESULT: safe to import")
    elif forced:
        lines.append("  RESULT: FAILED validation — overridden by --force")
        lines += [f"      ! {failure}" for failure in report.failures]
    else:
        lines.append("  RESULT: REFUSED — nothing will be written")
        lines += [f"      ! {failure}" for failure in report.failures]

    return "\n".join(lines)
