"""Read-only inspection of one import batch.

When a bulk upsert fails on the same batch every time, the first question is
what that batch actually contains — and until now the only way to find out was
to count rows in a spreadsheet. This renders exactly the rows the importer would
have sent as batch N, with the payload sizes it would have sent them as.

Nothing here touches Supabase. It is deliberately a pure function of the parsed
file so it can be run against the CSV on a laptop, with no credentials.
"""

from __future__ import annotations

import json
from statistics import median
from typing import Any, Optional

from app.sponsors.models import SponsorRecord

# The string fields worth measuring. `natural_key` is a fixed-width hash and
# tells you nothing by its length.
_TEXT_FIELDS = (
    "organisation_name", "town_city", "county", "type_rating", "route",
)

# A value longer than this is worth a second look whatever the rest of the batch
# looks like: the register's organisation names run to ~80 characters.
_ABSOLUTE_LONG = 120
# ...as is one that stands this far clear of its neighbours in the same column.
_RELATIVE_LONG = 3.0


class BatchOutOfRange(ValueError):
    """The requested batch number does not exist in this file."""


def batch_rows(
    records: list[SponsorRecord],
    batch_number: int,
    *,
    chunk_size: int,
    source_url: str = "(inspection)",
    published_at: Optional[str] = None,
) -> tuple[list[SponsorRecord], list[dict[str, Any]], int]:
    """The records, and the payload rows, that batch `batch_number` would carry.

    Returns `(records, rows, start_index)`. The rows are built by the same
    `as_row` the importer uses, with the same three fields it adds afterwards,
    so the byte counts below describe the real request rather than an
    approximation of it.
    """
    total_batches = -(-len(records) // chunk_size) if records else 0
    if batch_number < 1 or batch_number > total_batches:
        raise BatchOutOfRange(
            f"batch {batch_number} does not exist: this file makes "
            f"{total_batches} batch(es) of {chunk_size} from {len(records)} rows."
        )

    start = (batch_number - 1) * chunk_size
    slice_ = records[start : start + chunk_size]
    rows = []
    for record in slice_:
        row = record.as_row(source_url, published_at)
        # Exactly what `ingest_records` adds before sending. Note what is NOT
        # here: staging a row never writes is_current, withdrawn_at or
        # last_seen_at — finalization does.
        row["staged_import_id"] = "00000000-0000-0000-0000-000000000000"
        row["staged_seen_at"] = "2000-01-01T00:00:00+00:00"
        rows.append(row)
    return slice_, rows, start


def _payload_bytes(row: dict[str, Any]) -> int:
    """Size of one row as httpx serialises it into the request body."""
    return len(
        json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )


def _truncate(value: Any, limit: int = 70) -> str:
    text = "-" if value is None else str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def render_batch(
    records: list[SponsorRecord],
    batch_number: int,
    *,
    chunk_size: int,
    file_name: str,
    total_rows: Optional[int] = None,
) -> str:
    """A human-readable dump of one batch. Writes nothing anywhere."""
    slice_, rows, start = batch_rows(records, batch_number, chunk_size=chunk_size)
    total_batches = -(-len(records) // chunk_size)
    sizes = [_payload_bytes(row) for row in rows]
    end = start + len(slice_) - 1

    lines = [
        f"Batch {batch_number} of {total_batches}   file: {file_name}",
        f"chunk size {chunk_size} (SPONSOR_UPSERT_CHUNK)",
        f"rows {start}-{end} of {len(records)} deduplicated records"
        + (f" ({total_rows} data lines in the file)" if total_rows else ""),
        "",
        "PAYLOAD",
        f"  total          {sum(sizes):>9,} bytes",
        f"  largest row    {max(sizes):>9,} bytes  (row {start + sizes.index(max(sizes))})",
        f"  smallest row   {min(sizes):>9,} bytes",
        f"  mean row       {sum(sizes) // len(sizes):>9,} bytes",
        "",
    ]

    # Field lengths, and anything that stands out from its own column.
    flagged: list[str] = []
    lines.append("LONGEST VALUE PER FIELD")
    for field in _TEXT_FIELDS:
        lengths = [len(str(getattr(record, field) or "")) for record in slice_]
        widest = max(lengths)
        at = lengths.index(widest)
        lines.append(
            f"  {field:<18} {widest:>4} chars  row {start + at}  "
            f"{_truncate(getattr(slice_[at], field))!r}"
        )
        mid = median(lengths) or 1
        for offset, length in enumerate(lengths):
            if length > _ABSOLUTE_LONG or length > mid * _RELATIVE_LONG:
                flagged.append(
                    f"  row {start + offset} {field} {length} chars: "
                    f"{_truncate(getattr(slice_[offset], field), 160)!r}"
                )
    lines.append("")

    lines.append(
        f"UNUSUALLY LONG FIELDS (over {_ABSOLUTE_LONG} chars, or over "
        f"{_RELATIVE_LONG:g}x this batch's median for that field)"
    )
    lines.extend(flagged or ["  none — no value in this batch stands out by length"])
    lines.append("")

    lines.append("ROWS")
    lines.append(
        f"  {'index':>7} {'bytes':>6}  {'natural_key':<16} "
        "organisation_name | town_city | county | type_rating | route"
    )
    for offset, (record, size) in enumerate(zip(slice_, sizes)):
        lines.append(
            f"  {start + offset:>7} {size:>6}  {record.natural_key[:14]:<16} "
            f"{_truncate(record.organisation_name, 48)} | "
            f"{_truncate(record.town_city, 22)} | "
            f"{_truncate(record.county, 22)} | "
            f"{_truncate(record.type_rating, 34)} | "
            f"{_truncate(record.route, 26)}"
        )

    lines += ["", "(read-only — nothing was sent to Supabase)"]
    return "\n".join(lines)
