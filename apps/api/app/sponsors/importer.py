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
import logging
import os
import random
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


async def _write_batches(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    rows: list[dict[str, Any]],
    *,
    label: str,
    on_conflict: str = "natural_key",
    sleeper: Any = asyncio.sleep,
) -> int:
    """Upsert `rows` in batches, retrying transient failures. Returns retries used.

    A `ReadTimeout` does NOT prove the server discarded the request — PostgREST
    may well have committed it and simply answered too late. That is exactly why
    the retry is safe: `natural_key` is unique and the write is an upsert, so
    re-sending a batch that already landed updates the same rows instead of
    duplicating them. The alternative — treating a timeout as a failure and
    stopping — leaves an import half-applied with no way to tell how far it got.

    Raises if a batch exhausts its attempts, so the caller never proceeds to
    withdrawal on a partial edition.
    """
    batches = [chunk for chunk in _chunks(rows, UPSERT_CHUNK)]
    total_batches = len(batches)
    total_rows = len(rows)
    written = 0
    retries_used = 0

    for index, chunk in enumerate(batches, start=1):
        for attempt in range(1, BATCH_MAX_ATTEMPTS + 1):
            try:
                await rest.upsert(
                    client,
                    TABLE,
                    chunk,
                    on_conflict=on_conflict,
                    prefer="resolution=merge-duplicates,return=minimal",
                    timeout=IMPORT_REQUEST_TIMEOUT,
                )
                break
            except Exception as exc:  # noqa: BLE001 — classified immediately
                if not _is_retryable(exc) or attempt == BATCH_MAX_ATTEMPTS:
                    logger.error(
                        "[sponsor-import] %s batch %d/%d FAILED after %d attempt(s): "
                        "%s. %d/%d rows were written before this batch; the stored "
                        "register is untouched by withdrawal.",
                        label, index, total_batches, attempt,
                        type(exc).__name__, written, total_rows,
                    )
                    raise
                retries_used += 1
                delay = min(
                    BATCH_BASE_BACKOFF * (2 ** (attempt - 1)), BATCH_MAX_BACKOFF
                )
                delay += random.uniform(0, delay / 2)
                logger.warning(
                    "[sponsor-import] %s batch %d/%d retry=%d reason=%s "
                    "backoff=%.1fs",
                    label, index, total_batches, attempt,
                    type(exc).__name__, delay,
                )
                await sleeper(delay)

        written += len(chunk)
        logger.info(
            "[sponsor-import] %s batch %d/%d rows=%d completed | "
            "processed=%d remaining=%d (%.1f%%)",
            label, index, total_batches, len(chunk),
            written, total_rows - written,
            100.0 * written / total_rows if total_rows else 100.0,
        )

    return retries_used


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

        if run_id:
            await rest.update(
                client,
                IMPORTS_TABLE,
                {"id": f"eq.{run_id}"},
                {
                    "status": "success",
                    "source_url": resolved_url,
                    "register_published_at": published_at,
                    "finished_at": _now_iso(),
                    **stats.as_columns(),
                },
            )
        logger.info("Register import finished: %s", stats.as_columns())
        return run_id, stats

    except Exception as exc:  # noqa: BLE001 — recorded, then re-raised
        logger.exception("Register import failed")
        if run_id:
            try:
                await rest.update(
                    client,
                    IMPORTS_TABLE,
                    {"id": f"eq.{run_id}"},
                    {
                        "status": "error",
                        "error": f"{type(exc).__name__}: {exc}"[:1000],
                        "finished_at": _now_iso(),
                        **stats.as_columns(),
                    },
                )
            except Exception:  # noqa: BLE001 — never mask the original failure
                logger.exception("Could not record the import failure")
        raise
    finally:
        if owns_client:
            await client.aclose()
