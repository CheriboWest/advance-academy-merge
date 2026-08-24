"""Sponsor-register ingestion: download → parse → stage → finalize.

Safe to run repeatedly. Rows are keyed by `natural_key`, so a second run over an
unchanged file rewrites the same rows rather than duplicating them.

Writing a row and publishing it are two different acts
-----------------------------------------------------
Every batch upsert stamps `staged_import_id` and touches nothing that decides
what the register currently says. Only `finalize_sponsor_register_import()` —
one database call, made after every batch has been confirmed — promotes this
edition's rows to current and withdraws the live rows it did not carry.

That split is what makes a failed import harmless. A run that dies halfway
leaves rows carrying its marker, and no reader looks at that marker: the rows it
inserted are `is_current = false` by column default, the rows it updated keep
the currency the last successful edition gave them, and a licence a previous
edition withdrew is NOT resurrected by a partial write. The previous edition
stays authoritative until a new one finishes in full.

It is also what makes six-figure imports possible at all. Deciding what to
withdraw used to mean paging the entire table over PostgREST — 138 requests
before the first row was written, of which the real import survived four. The
database can answer the same question with one UPDATE.

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

# Finalization is one statement over the whole table, so it gets its own,
# larger budget. It is idempotent — promoting the same rows twice is a no-op —
# which is what makes retrying a timed-out call safe.
FINALIZE_TIMEOUT = float(os.getenv("SPONSOR_FINALIZE_TIMEOUT", "300"))
FINALIZE_ATTEMPTS = int(os.getenv("SPONSOR_FINALIZE_ATTEMPTS", "3"))
FINALIZE_FUNCTION = "finalize_sponsor_register_import"

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


async def ingest_records(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    records: list[SponsorRecord],
    source_url: str,
    published_at: Optional[str],
    stats: ImportStats,
    *,
    import_id: str,
    sleeper: Any = asyncio.sleep,
) -> None:
    """Stage `records` under `import_id`. Publishes nothing.

    Every row carries the edition's marker and its published content. What it
    deliberately does NOT carry is `is_current`, `withdrawn_at` or
    `last_seen_at`: those decide what the register says today, and a batch that
    might be one of many still to fail has no business deciding that. New rows
    take the column default (`is_current = false`, since migration 0009) and
    existing rows keep whatever the last successful edition left them.

    `finalize_edition` publishes the result, and only after every batch here has
    been confirmed.

    Split out from `run_import` so the whole write path can be exercised with a
    fixture file and no network.
    """
    if not import_id:
        raise RuntimeError(
            "Refusing to stage rows without an import id: rows written without "
            "one could never be published, and would be indistinguishable from "
            "the previous edition's."
        )

    staged_at = datetime.now(timezone.utc).isoformat()
    rows: list[dict[str, Any]] = []
    for record in records:
        row = record.as_row(source_url, published_at)
        row["staged_import_id"] = import_id
        row["staged_seen_at"] = staged_at
        rows.append(row)

    logger.info(
        "[sponsor-import] staging %d rows for import %s in %d batches of %d",
        len(rows), import_id, -(-len(rows) // UPSERT_CHUNK), UPSERT_CHUNK,
    )

    # `_write_batches` raises if any chunk cannot be written, so the caller
    # never reaches finalization on a partial edition.
    retries = await _write_batches(
        client, rest, rows, label="edition", sleeper=sleeper
    )
    stats.rows_processed = len(rows)
    if retries:
        logger.info("[sponsor-import] staging completed with %d retries", retries)


async def finalize_edition(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    import_id: str,
    stats: ImportStats,
    *,
    sleeper: Any = asyncio.sleep,
) -> None:
    """Publish the staged edition, in the database, in one call.

    `finalize_sponsor_register_import` promotes every row this import staged and
    withdraws every live row it did not carry. Doing it there rather than here
    is the whole point: the alternative is downloading 138,000 natural keys to
    work out a set difference Postgres can compute without moving any of them.

    Retried on transient failures because it is idempotent — a call that
    committed and then timed out is republished to the same state by the next
    one. Raises if it cannot be completed, so a run whose edition was never
    published cannot be recorded as a success.
    """
    for attempt in range(1, FINALIZE_ATTEMPTS + 1):
        started = time.monotonic()
        try:
            result = await rest.rpc(
                client,
                FINALIZE_FUNCTION,
                {"p_import_id": import_id},
                timeout=FINALIZE_TIMEOUT,
            )
            break
        except Exception as exc:  # noqa: BLE001 — classified immediately
            if not _is_retryable(exc) or attempt == FINALIZE_ATTEMPTS:
                logger.error(
                    "[sponsor-import] finalization FAILED after %d attempt(s): "
                    "%s. The edition stays staged and unpublished; the previous "
                    "edition is still the authoritative one, and re-running this "
                    "file will stage and publish it in full.",
                    attempt, type(exc).__name__,
                )
                raise
            delay = min(BATCH_BASE_BACKOFF * (2 ** (attempt - 1)), BATCH_MAX_BACKOFF)
            logger.warning(
                "[sponsor-import] finalization retry=%d reason=%s elapsed=%.1fs "
                "backoff=%.1fs",
                attempt, type(exc).__name__, time.monotonic() - started, delay,
            )
            await sleeper(delay)

    row = _first_row(result)
    if row is None:
        raise RuntimeError(
            f"{FINALIZE_FUNCTION} returned no counts; the edition's state is "
            "unknown. Check sponsor_licences before treating this run as done."
        )

    promoted = int(row.get("rows_promoted") or 0)
    stats.rows_withdrawn = int(row.get("rows_withdrawn") or 0)
    stats.rows_current_after = int(row.get("rows_current") or 0)

    logger.info(
        "[sponsor-import] finalized import %s: promoted=%d withdrawn=%d "
        "current=%d",
        import_id, promoted, stats.rows_withdrawn, stats.rows_current_after,
    )

    # Reconciliation, not bookkeeping. `rows_promoted` is counted from the rows
    # the database actually holds for this import, so a disagreement with what
    # we sent means rows went missing between here and there.
    if promoted != stats.rows_processed:
        logger.warning(
            "[sponsor-import] staged %d rows but the database promoted %d. "
            "Re-run the import over the same file to finish it.",
            stats.rows_processed, promoted,
        )
    stats.rows_processed = promoted


def _first_row(result: Any) -> Optional[dict[str, Any]]:
    """The single row a set-returning RPC produced, whatever shape it arrives in.

    PostgREST returns a list for a `returns table` function, but returns the
    object directly when the function is declared to return one row.
    """
    if isinstance(result, list):
        return result[0] if result else None
    if isinstance(result, dict):
        return result
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
        if not run_id:
            # Everything downstream is keyed on this id: rows are staged under
            # it and published by it. Without one there is no way to publish an
            # edition, and no way to tell its rows from the last one's.
            raise RuntimeError(
                "Could not create the sponsor_register_imports row, so this run "
                "has no id to stage rows under. Nothing was written."
            )

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
            import_id=run_id, sleeper=sleeper,
        )

        # Every batch is confirmed. Only now does anything become current, and
        # only now can anything be withdrawn.
        await finalize_edition(client, rest, run_id, stats, sleeper=sleeper)

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
