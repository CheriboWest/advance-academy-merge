"""Sponsor-register ingestion: download → parse → upsert → mark withdrawn.

Safe to run repeatedly. Rows are keyed by `natural_key`, so a second run over an
unchanged file inserts nothing, updates nothing, and reports every row as
unchanged.

Register rows are never deleted. A row that stops appearing is marked
`is_current = false` with a `withdrawn_at` stamp: absence from today's file means
the licence is not listed today, which is not the same as it never having
existed, and deleting it would destroy the only record that it once was.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

import httpx

from app.crawler.supabase_rest import SupabaseRest
from app.sponsors import govuk
from app.sponsors.models import ImportStats, SponsorRecord
from app.sponsors.parser import decode_detail, deduplicate, parse_register_detail
from app.sponsors.validation import ValidationReport, build_report, render

logger = logging.getLogger("careerhub.sponsors.importer")


class RegisterValidationError(RuntimeError):
    """A parsed file failed the pre-import safety checks. Nothing was written."""

    def __init__(self, report: ValidationReport) -> None:
        super().__init__("; ".join(report.failures))
        self.report = report

# PostgREST request sizing. The register runs to ~142,000 rows, so writes are
# chunked; reads page through the whole table.
#
# 250 rather than 500: each batch is an ON CONFLICT upsert against a table with
# a unique index on `natural_key`, and the cost of maintaining that index grows
# with the table. At 500 the later batches of a full import exceeded the request
# timeout. Halving the batch roughly halves the per-request work, at the cost of
# twice as many requests — which are cheap and independently retryable, unlike a
# batch that times out.
UPSERT_CHUNK = int(os.getenv("SPONSOR_UPSERT_CHUNK", "250"))
SELECT_PAGE = 1000

# Bulk writes get their own timeout. The 15 seconds SupabaseRest defaults to is
# right for interactive requests and far too short for a 250-row upsert into a
# six-figure table.
IMPORT_REQUEST_TIMEOUT = float(os.getenv("SPONSOR_IMPORT_TIMEOUT", "120"))

# Per-batch retry budget. Bounded so a genuinely broken import fails in minutes
# rather than grinding on.
BATCH_MAX_ATTEMPTS = int(os.getenv("SPONSOR_BATCH_ATTEMPTS", "5"))
BATCH_BASE_BACKOFF = 1.0
BATCH_MAX_BACKOFF = 30.0

# Statuses worth trying again. A 4xx that is not 429 means the request itself is
# wrong — the schema, the payload, the key — and will fail identically forever.
RETRYABLE_STATUS = {429, 500, 502, 503, 504}

# Adaptive splitting. A batch that exhausts its retries on a transient error is
# halved and each half retried on its own, repeatedly, until either the rows go
# through or the chunk is small enough to name the offending rows outright.
#
# The floor is where narrowing stops paying: at ten rows the log can print every
# row in the chunk, which is the actual goal — a batch that cannot be written
# should end with "these rows", not "somewhere in those 250".
MIN_SPLIT_ROWS = int(os.getenv("SPONSOR_MIN_SPLIT_ROWS", "10"))

# How many rows a failing chunk may print. A chunk at the floor prints in full;
# a full-size batch that failed permanently prints its head and says so.
_MAX_LOGGED_ROWS = 25

# Splitting is bounded in wall-clock as well as in depth. Unbounded, a dead
# endpoint would generate 63 chunks x 5 attempts x a 120-second timeout — hours
# of retrying an import that was never going to finish. Past the budget the
# batch fails and names its rows.
SPLIT_MAX_SECONDS = float(os.getenv("SPONSOR_SPLIT_BUDGET", "900"))

# The final `sponsor_register_imports` write gets its own short-lived client.
# When the import dies, the pooled connection is by definition the one that just
# stalled; reusing it to record the failure is how a failed run ends up stuck at
# "running" forever.
STATUS_WRITE_TIMEOUT = float(os.getenv("SPONSOR_STATUS_TIMEOUT", "20"))
STATUS_WRITE_ATTEMPTS = int(os.getenv("SPONSOR_STATUS_ATTEMPTS", "3"))

TABLE = "sponsor_licences"
IMPORTS_TABLE = "sponsor_register_imports"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _chunks(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _is_retryable(exc: Exception) -> bool:
    """Whether a failed batch write is worth sending again.

    Timeouts and connection failures are retryable, and so are 429 and the 5xx
    family. Everything else — a malformed payload, a schema mismatch, a bad key —
    is permanent, and retrying it just delays a failure that is already certain.
    """
    if isinstance(
        exc,
        (
            httpx.ReadTimeout,
            httpx.ConnectTimeout,
            httpx.WriteTimeout,
            httpx.PoolTimeout,
            httpx.ConnectError,
            httpx.ReadError,
            httpx.RemoteProtocolError,
        ),
    ):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in RETRYABLE_STATUS
    return False


@dataclass
class _WriteProgress:
    """Running totals for one call to `_write_batches`, shared by its children."""

    label: str
    total_batches: int
    total_rows: int
    written: int = 0
    retries: int = 0


def _short_key(value: Any) -> str:
    """The first 12 characters of a natural key — enough to grep a log with."""
    return (str(value) if value else "?")[:12]


def _endpoints(rows: list[dict[str, Any]]) -> str:
    """First and last row of a chunk, for the line logged before it is sent.

    Withdrawal batches carry only `natural_key`, so the organisation name is
    optional here.
    """
    first, last = rows[0], rows[-1]
    return (
        f'first={_short_key(first.get("natural_key"))} '
        f'"{first.get("organisation_name") or "-"}" | '
        f'last={_short_key(last.get("natural_key"))} '
        f'"{last.get("organisation_name") or "-"}"'
    )


def _log_offending_rows(
    rows: list[dict[str, Any]], *, start_index: int, tag: str
) -> None:
    """Name every row of a chunk that could not be written.

    This is the point of splitting. A 250-row batch that fails tells you
    nothing; a chunk this size can be printed in full, and the natural keys are
    exactly what `--inspect-batch` and a `sponsor_licences` query take.
    """
    # A chunk that reached the split floor is small enough to print whole. A
    # full-size batch that failed permanently is not, and 250 error lines would
    # bury the reason it failed — the first few plus the row range are enough to
    # take to `--inspect-batch`.
    shown = rows[:_MAX_LOGGED_ROWS]
    logger.error(
        "[sponsor-import] batch %s could not be written. The %d row(s) it "
        "carries, in file order%s:",
        tag, len(rows),
        "" if len(shown) == len(rows) else f" (first {len(shown)} shown)",
    )
    for offset, row in enumerate(shown):
        logger.error(
            "[sponsor-import]   row %d natural_key=%s organisation_name=%r "
            "town_city=%r county=%r type_rating=%r route=%r bytes=%d",
            start_index + offset,
            row.get("natural_key"),
            row.get("organisation_name"),
            row.get("town_city"),
            row.get("county"),
            row.get("type_rating"),
            row.get("route"),
            len(json.dumps(row, default=str).encode("utf-8")),
        )
    if len(shown) != len(rows):
        logger.error(
            "[sponsor-import]   ...and %d more, rows %d-%d. Run "
            "`scripts/import_sponsor_register.py --file <csv> --inspect-batch "
            "%s` to see the whole batch.",
            len(rows) - len(shown), start_index + len(shown),
            start_index + len(rows) - 1, tag.rstrip("AB") or tag,
        )


async def _write_chunk(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    rows: list[dict[str, Any]],
    *,
    progress: _WriteProgress,
    number: int,
    suffix: str,
    depth: int,
    start_index: int,
    deadline: float,
    on_conflict: str,
    sleeper: Any,
) -> None:
    """Write one chunk, halving it and recursing if it will not go through.

    Retries first, on the normal policy. If the chunk still fails on a transient
    error it is split in two and each half written independently — a batch that
    times out repeatedly is usually one slow or oversized row dragging its 249
    neighbours down with it, and halving isolates it in a handful of rounds.

    Deeper chunks get fewer attempts: by then the transient explanation is
    losing credibility, and the same total patience is better spent narrowing
    than repeating. Splitting stops at `MIN_SPLIT_ROWS`, or when the batch's
    time budget runs out; either way the chunk's rows are logged by name and the
    failure is raised, so the caller never reaches withdrawal.

    Re-sending is safe at every level: the write is an upsert keyed on
    `natural_key`, so a parent that committed before its client gave up is
    updated by its children rather than duplicated.
    """
    tag = f"{number}{suffix}"
    attempts = BATCH_MAX_ATTEMPTS if depth == 0 else max(2, BATCH_MAX_ATTEMPTS - depth)
    span = f"{start_index}-{start_index + len(rows) - 1}"
    started = time.monotonic()

    logger.info(
        "[sponsor-import] %s batch %s/%d depth=%d rows=%d range=%s sending | %s",
        progress.label, tag, progress.total_batches, depth, len(rows), span,
        _endpoints(rows),
    )

    for attempt in range(1, attempts + 1):
        try:
            await rest.upsert(
                client,
                TABLE,
                rows,
                on_conflict=on_conflict,
                # merge-duplicates makes the re-send an update rather than a
                # conflict; return=minimal keeps a 250-row response empty.
                prefer="resolution=merge-duplicates,return=minimal",
                timeout=IMPORT_REQUEST_TIMEOUT,
            )
        except Exception as exc:  # noqa: BLE001 — classified immediately
            retryable = _is_retryable(exc)
            elapsed = time.monotonic() - started

            if retryable and attempt < attempts:
                progress.retries += 1
                delay = min(
                    BATCH_BASE_BACKOFF * (2 ** (attempt - 1)), BATCH_MAX_BACKOFF
                )
                delay += random.uniform(0, delay / 2)
                logger.warning(
                    "[sponsor-import] %s batch %s retry=%d reason=%s "
                    "elapsed=%.1fs backoff=%.1fs",
                    progress.label, tag, attempt, type(exc).__name__, elapsed, delay,
                )
                await sleeper(delay)
                continue

            if not retryable:
                logger.error(
                    "[sponsor-import] %s batch %s/%d rows=%d range=%s FAILED with "
                    "%s, which is permanent — the request itself is wrong, so "
                    "neither retrying nor splitting it would help.",
                    progress.label, tag, progress.total_batches, len(rows), span,
                    type(exc).__name__,
                )
                _log_offending_rows(rows, start_index=start_index, tag=tag)
                raise

            if len(rows) <= MIN_SPLIT_ROWS:
                logger.error(
                    "[sponsor-import] %s batch %s/%d rows=%d range=%s FAILED after "
                    "%d attempt(s) with %s and is at the %d-row split floor, so it "
                    "cannot be narrowed further. The import stops here: %d/%d rows "
                    "are written, nothing has been withdrawn, and re-running the "
                    "same file will skip straight past the rows already stored.",
                    progress.label, tag, progress.total_batches, len(rows), span,
                    attempt, type(exc).__name__, MIN_SPLIT_ROWS,
                    progress.written, progress.total_rows,
                )
                _log_offending_rows(rows, start_index=start_index, tag=tag)
                raise

            if time.monotonic() >= deadline:
                logger.error(
                    "[sponsor-import] %s batch %s/%d rows=%d range=%s FAILED with "
                    "%s and batch %d has now spent its %.0fs split budget, so it "
                    "will not be narrowed further. The import stops here: %d/%d "
                    "rows are written and nothing has been withdrawn.",
                    progress.label, tag, progress.total_batches, len(rows), span,
                    type(exc).__name__, number, SPLIT_MAX_SECONDS,
                    progress.written, progress.total_rows,
                )
                _log_offending_rows(rows, start_index=start_index, tag=tag)
                raise

            half = len(rows) // 2
            left, right = rows[:half], rows[half:]
            logger.warning(
                "[sponsor-import] %s batch %s/%d failed after %d attempts (%s); "
                "splitting %d → %d + %d (depth %d, elapsed %.1fs)",
                progress.label, tag, progress.total_batches, attempt,
                type(exc).__name__, len(rows), len(left), len(right),
                depth + 1, elapsed,
            )
            for child, child_suffix, child_start in (
                (left, suffix + "A", start_index),
                (right, suffix + "B", start_index + half),
            ):
                await _write_chunk(
                    client, rest, child,
                    progress=progress, number=number, suffix=child_suffix,
                    depth=depth + 1, start_index=child_start, deadline=deadline,
                    on_conflict=on_conflict, sleeper=sleeper,
                )
            return

        progress.written += len(rows)
        logger.info(
            "[sponsor-import] %s batch %s/%d rows=%d range=%s completed "
            "attempts=%d elapsed=%.1fs | processed=%d remaining=%d (%.1f%%)",
            progress.label, tag, progress.total_batches, len(rows), span,
            attempt, time.monotonic() - started,
            progress.written, progress.total_rows - progress.written,
            100.0 * progress.written / progress.total_rows
            if progress.total_rows else 100.0,
        )
        return


async def _write_batches(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    rows: list[dict[str, Any]],
    *,
    label: str,
    on_conflict: str = "natural_key",
    sleeper: Any = asyncio.sleep,
) -> int:
    """Upsert `rows` in batches, retrying and splitting. Returns retries used.

    A `ReadTimeout` does NOT prove the server discarded the request — PostgREST
    may well have committed it and simply answered too late. That is exactly why
    both the retry and the split are safe: `natural_key` is unique and the write
    is an upsert, so re-sending rows that already landed updates them instead of
    duplicating them.

    Raises if a chunk cannot be written, so the caller never proceeds to
    withdrawal on a partial edition.
    """
    batches = list(_chunks(rows, UPSERT_CHUNK))
    progress = _WriteProgress(
        label=label, total_batches=len(batches), total_rows=len(rows)
    )

    start_index = 0
    for number, chunk in enumerate(batches, start=1):
        await _write_chunk(
            client, rest, chunk,
            progress=progress, number=number, suffix="", depth=0,
            start_index=start_index,
            # Per batch, not per import: a slow batch must not eat the budget of
            # the batches after it.
            deadline=time.monotonic() + SPLIT_MAX_SECONDS,
            on_conflict=on_conflict, sleeper=sleeper,
        )
        start_index += len(chunk)

    return progress.retries


async def _existing_rows(
    client: httpx.AsyncClient, rest: SupabaseRest
) -> dict[str, dict[str, Any]]:
    """Every stored register row, keyed by `natural_key`.

    Paged rather than fetched in one request: PostgREST caps rows per response,
    and a silent truncation here would make existing rows look new and
    everything absent look withdrawn.
    """
    stored: dict[str, dict[str, Any]] = {}
    offset = 0
    columns = (
        "id,natural_key,organisation_name,town_city,county,type_rating,route,"
        "licence_type,rating,is_current"
    )
    while True:
        rows = await rest.select(
            client,
            TABLE,
            {
                "select": columns,
                "order": "natural_key.asc",
                "limit": str(SELECT_PAGE),
                "offset": str(offset),
            },
        )
        for row in rows:
            key = row.get("natural_key")
            if key:
                stored[str(key)] = row
        if len(rows) < SELECT_PAGE:
            break
        offset += SELECT_PAGE
    return stored


def _is_unchanged(record: SponsorRecord, stored: dict[str, Any]) -> bool:
    """Whether the stored row already carries this record's published values."""
    return record.content_fields() == (
        stored.get("organisation_name"),
        stored.get("town_city"),
        stored.get("county"),
        stored.get("type_rating"),
        stored.get("route"),
        stored.get("licence_type"),
        stored.get("rating"),
    ) and bool(stored.get("is_current"))


async def ingest_records(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    records: list[SponsorRecord],
    source_url: str,
    published_at: Optional[str],
    stats: ImportStats,
    sleeper: Any = asyncio.sleep,
) -> None:
    """Upsert `records` and withdraw stored rows the file no longer contains.

    Split out from `run_import` so the whole write path can be exercised with a
    fixture file and no network.
    """
    stored = await _existing_rows(client, rest)
    seen_now = datetime.now(timezone.utc).isoformat()

    # Classify first, count later. These tallies describe what the edition WILL
    # do; they are copied into `stats` only after every batch is confirmed, so a
    # failed import never reports rows it did not write.
    to_write: list[dict[str, Any]] = []
    planned_inserted = planned_updated = planned_unchanged = 0

    for record in records:
        existing = stored.get(record.natural_key)
        row = record.as_row(source_url, published_at)
        row["last_seen_at"] = seen_now
        row["is_current"] = True
        row["withdrawn_at"] = None

        if existing is None:
            planned_inserted += 1
            row["first_seen_at"] = seen_now
        elif _is_unchanged(record, existing):
            planned_unchanged += 1
            # Still written: `last_seen_at` is how we prove the row is in
            # today's edition, which is what stops it being withdrawn below.
        else:
            planned_updated += 1
        to_write.append(row)

    logger.info(
        "[sponsor-import] writing %d rows in %d batches of %d "
        "(insert=%d update=%d unchanged=%d)",
        len(to_write), -(-len(to_write) // UPSERT_CHUNK), UPSERT_CHUNK,
        planned_inserted, planned_updated, planned_unchanged,
    )

    # Stage the whole edition first. `_write_batches` raises if any batch
    # exhausts its retries, so the withdrawal below is unreachable unless every
    # new row is safely in place. Withdrawal is the only step that changes what
    # the register says is current, so it happens last and only on success.
    retries = await _write_batches(
        client, rest, to_write, label="edition", sleeper=sleeper
    )

    # Every batch confirmed. Only now do the numbers become facts.
    stats.rows_inserted = planned_inserted
    stats.rows_updated = planned_updated
    stats.rows_unchanged = planned_unchanged
    if retries:
        logger.info("[sponsor-import] edition completed with %d retries", retries)

    # Anything currently marked live that this edition did not contain.
    present = {record.natural_key for record in records}
    withdrawn = [
        row for key, row in stored.items()
        if key not in present and row.get("is_current")
    ]
    if withdrawn:
        await _write_batches(
            client,
            rest,
            [
                {
                    "natural_key": row["natural_key"],
                    "is_current": False,
                    "withdrawn_at": seen_now,
                }
                for row in withdrawn
            ],
            label="withdrawal",
            sleeper=sleeper,
        )
    stats.rows_withdrawn = len(withdrawn)


async def _confirm_edition(
    client: httpx.AsyncClient, rest: SupabaseRest, source_url: str
) -> Optional[int]:
    """Count the rows the database actually holds for this edition.

    Reconciliation, not bookkeeping: a timed-out batch may have committed, so
    the only trustworthy count comes from asking the database afterwards.
    Best-effort — a failure here must not fail an import that already succeeded.
    """
    try:
        return await rest.count(
            client,
            TABLE,
            {"source_url": f"eq.{source_url}", "is_current": "eq.true"},
            timeout=IMPORT_REQUEST_TIMEOUT,
        )
    except Exception:  # noqa: BLE001 — reconciliation is advisory
        logger.warning("[sponsor-import] could not reconcile the edition count")
        return None


async def _record_status(
    rest: SupabaseRest,
    run_id: str,
    values: dict[str, Any],
    *,
    client_factory: Any = httpx.AsyncClient,
    sleeper: Any = asyncio.sleep,
) -> bool:
    """Write the run's final row on a connection of its own. Never raises.

    Deliberately not the client the import has been using: by the time this
    matters, that client is the one whose request just timed out, and its pooled
    connection may be wedged behind a response that is never coming. A run that
    dies AND fails to record why is indistinguishable from a run still going, so
    this gets a fresh client, a short timeout, and its own small retry.
    """
    if not run_id:
        return False

    last_error: Optional[Exception] = None
    for attempt in range(1, STATUS_WRITE_ATTEMPTS + 1):
        try:
            async with client_factory(timeout=STATUS_WRITE_TIMEOUT) as fresh:
                await rest.update(
                    fresh,
                    IMPORTS_TABLE,
                    {"id": f"eq.{run_id}"},
                    values,
                    timeout=STATUS_WRITE_TIMEOUT,
                )
            if attempt > 1:
                logger.info(
                    "[sponsor-import] recorded status=%s on attempt %d",
                    values.get("status"), attempt,
                )
            return True
        except Exception as exc:  # noqa: BLE001 — reported, never raised
            last_error = exc
            if attempt < STATUS_WRITE_ATTEMPTS:
                logger.warning(
                    "[sponsor-import] could not record status=%s (%s); "
                    "retrying on a new connection (%d/%d)",
                    values.get("status"), type(exc).__name__,
                    attempt, STATUS_WRITE_ATTEMPTS,
                )
                await sleeper(min(2.0 * attempt, 5.0))

    logger.error(
        "[sponsor-import] FAILED to record status=%s for run %s after %d "
        "attempts (%s: %s). The run row is left as it was — check "
        "sponsor_register_imports before trusting its status.",
        values.get("status"), run_id, STATUS_WRITE_ATTEMPTS,
        type(last_error).__name__, last_error,
    )
    return False


async def previous_successful_rows(
    client: httpx.AsyncClient, rest: SupabaseRest
) -> Optional[int]:
    """`rows_parsed` from the last successful import, for the size comparison."""
    rows = await rest.select(
        client,
        IMPORTS_TABLE,
        {
            "select": "rows_parsed",
            "status": "eq.success",
            "order": "started_at.desc",
            "limit": "1",
        },
    )
    if rows and isinstance(rows[0].get("rows_parsed"), (int, float)):
        return int(rows[0]["rows_parsed"])
    return None


async def run_import(
    rest: SupabaseRest,
    *,
    client: Optional[httpx.AsyncClient] = None,
    csv_bytes: Optional[bytes] = None,
    source_url: Optional[str] = None,
    force: bool = False,
    sleeper: Any = asyncio.sleep,
    client_factory: Any = httpx.AsyncClient,
) -> tuple[str, ImportStats]:
    """Ingest the current register. Returns `(import_run_id, stats)`.

    Pass `csv_bytes` to ingest a file you already have (tests, or a manually
    downloaded edition); otherwise the current CSV is located on GOV.UK and
    downloaded. Every run records a `sponsor_register_imports` row, including
    failures — an import that dies is visible rather than silent.

    The parsed file is validated before a single register row is written. A file
    that parses into the wrong shape — a renamed column, a truncated download —
    is the dangerous case: it would import a handful of rows and withdraw the
    rest of the register. `force=True` overrides the checks for a genuinely
    smaller edition a human has inspected.
    """
    stats = ImportStats()
    owns_client = client is None
    client = client or httpx.AsyncClient()

    run_id = ""
    published_at: Optional[str] = None
    resolved_url = source_url or govuk.PUBLICATION_URL

    try:
        created = await rest.insert(
            client,
            IMPORTS_TABLE,
            [{"status": "running", "source_url": resolved_url}],
        )
        run_id = str(created[0]["id"]) if created else ""

        if csv_bytes is None:
            located = await govuk.find_current_csv(client)
            resolved_url = located.csv_url
            published_at = located.published_at.isoformat() if located.published_at else None
            logger.info(
                "Register located via %s: %s (published %s)",
                located.discovered_from,
                resolved_url,
                published_at or "unknown",
            )
            csv_bytes = await govuk.download_csv(client, resolved_url)

        text, encoding = decode_detail(csv_bytes)
        parsed = parse_register_detail(text)
        records, duplicates = deduplicate(parsed.records)

        stats.rows_downloaded = parsed.data_lines
        stats.rows_parsed = len(records)
        stats.rows_rejected = len(parsed.rejections) + duplicates
        stats.rejections = parsed.rejections

        report = build_report(
            file_name=source_url or resolved_url,
            encoding=encoding,
            header_line=parsed.header_line,
            header_row=parsed.header_row,
            column_map=parsed.column_map,
            records=records,
            rejections=parsed.rejections,
            data_lines=parsed.data_lines,
            duplicates=duplicates,
            previous_rows_parsed=await previous_successful_rows(client, rest),
        )
        logger.info("Register validation:\n%s", render(report, forced=force))

        # The gate. Nothing has touched `sponsor_licences` yet, so refusing here
        # leaves the stored register exactly as it was.
        if not report.ok and not force:
            raise RegisterValidationError(report)
        if not report.ok:
            logger.warning(
                "Register validation failed but --force was supplied; importing "
                "anyway: %s", "; ".join(report.failures),
            )

        await ingest_records(
            client, rest, records, resolved_url, published_at, stats,
            sleeper=sleeper,
        )

        confirmed = await _confirm_edition(client, rest, resolved_url)
        if confirmed is not None:
            logger.info(
                "[sponsor-import] reconciled: %d rows in the database carry this "
                "edition's source URL (parsed %d)",
                confirmed, stats.rows_parsed,
            )
            if confirmed < stats.rows_parsed:
                logger.warning(
                    "[sponsor-import] the database holds fewer rows for this "
                    "edition (%d) than were parsed (%d); re-run the import to "
                    "finish it",
                    confirmed, stats.rows_parsed,
                )

        await _record_status(
            rest,
            run_id,
            {
                "status": "success",
                "source_url": resolved_url,
                "register_published_at": published_at,
                "finished_at": _now_iso(),
                **stats.as_columns(),
            },
            client_factory=client_factory,
            sleeper=sleeper,
        )
        logger.info("Register import finished: %s", stats.as_columns())
        return run_id, stats

    except Exception as exc:  # noqa: BLE001 — recorded, then re-raised
        logger.exception("Register import failed")
        # `_record_status` swallows its own failures, so the original
        # exception below is never masked by a bookkeeping error.
        await _record_status(
            rest,
            run_id,
            {
                "status": "error",
                "error": f"{type(exc).__name__}: {exc}"[:1000],
                "finished_at": _now_iso(),
                **stats.as_columns(),
            },
            client_factory=client_factory,
            sleeper=sleeper,
        )
        raise
    finally:
        if owns_client:
            await client.aclose()
