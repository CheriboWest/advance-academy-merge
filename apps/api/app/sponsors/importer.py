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

import logging
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

import httpx

from app.crawler.supabase_rest import SupabaseRest
from app.sponsors import govuk
from app.sponsors.models import ImportStats, SponsorRecord
from app.sponsors.parser import decode, deduplicate, parse_register

logger = logging.getLogger("careerhub.sponsors.importer")

# PostgREST request sizing. The register runs to tens of thousands of rows, so
# writes are chunked; reads page through the whole table.
UPSERT_CHUNK = 500
SELECT_PAGE = 1000

TABLE = "sponsor_licences"
IMPORTS_TABLE = "sponsor_register_imports"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _chunks(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


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
) -> None:
    """Upsert `records` and withdraw stored rows the file no longer contains.

    Split out from `run_import` so the whole write path can be exercised with a
    fixture file and no network.
    """
    stored = await _existing_rows(client, rest)
    seen_now = datetime.now(timezone.utc).isoformat()

    to_write: list[dict[str, Any]] = []
    for record in records:
        existing = stored.get(record.natural_key)
        row = record.as_row(source_url, published_at)
        row["last_seen_at"] = seen_now
        row["is_current"] = True
        row["withdrawn_at"] = None

        if existing is None:
            stats.rows_inserted += 1
            row["first_seen_at"] = seen_now
            to_write.append(row)
        elif _is_unchanged(record, existing):
            stats.rows_unchanged += 1
            # Still written: `last_seen_at` is how we prove the row is in
            # today's edition, which is what stops it being withdrawn below.
            to_write.append(row)
        else:
            stats.rows_updated += 1
            to_write.append(row)

    for chunk in _chunks(to_write, UPSERT_CHUNK):
        await rest.upsert(
            client,
            TABLE,
            chunk,
            on_conflict="natural_key",
            prefer="resolution=merge-duplicates,return=minimal",
        )

    # Anything currently marked live that this edition did not contain.
    present = {record.natural_key for record in records}
    withdrawn = [
        row for key, row in stored.items()
        if key not in present and row.get("is_current")
    ]
    for chunk in _chunks(withdrawn, UPSERT_CHUNK):
        await rest.upsert(
            client,
            TABLE,
            [
                {
                    "natural_key": row["natural_key"],
                    "is_current": False,
                    "withdrawn_at": seen_now,
                }
                for row in chunk
            ],
            on_conflict="natural_key",
            prefer="resolution=merge-duplicates,return=minimal",
        )
    stats.rows_withdrawn = len(withdrawn)


async def run_import(
    rest: SupabaseRest,
    *,
    client: Optional[httpx.AsyncClient] = None,
    csv_bytes: Optional[bytes] = None,
    source_url: Optional[str] = None,
) -> tuple[str, ImportStats]:
    """Ingest the current register. Returns `(import_run_id, stats)`.

    Pass `csv_bytes` to ingest a file you already have (tests, or a manually
    downloaded edition); otherwise the current CSV is located on GOV.UK and
    downloaded. Every run records a `sponsor_register_imports` row, including
    failures — an import that dies is visible rather than silent.
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

        text = decode(csv_bytes)
        records, rejections, data_lines = parse_register(text)
        records, duplicates = deduplicate(records)

        stats.rows_downloaded = data_lines
        stats.rows_parsed = len(records)
        stats.rows_rejected = len(rejections) + duplicates
        stats.rejections = rejections

        logger.info(
            "Register parsed: %d lines, %d records, %d rejected, %d in-file duplicates",
            data_lines, len(records), len(rejections), duplicates,
        )
        for rejected in rejections[:20]:
            logger.warning(
                "Rejected line %d: %s (%s)",
                rejected.line_number, rejected.reason, rejected.raw,
            )

        await ingest_records(
            client, rest, records, resolved_url, published_at, stats
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
