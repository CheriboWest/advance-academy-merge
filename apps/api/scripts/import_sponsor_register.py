#!/usr/bin/env python3
"""Run the sponsor-register importer from the command line.

    # Validate a manually downloaded edition without writing anything.
    # --validate is an alias of --dry-run: both parse the whole file, normalize,
    # run every uniqueness and safety check, print the report, and touch no
    # database. There is one code path, so the thing you validate is exactly the
    # thing that would be imported.
    python scripts/import_sponsor_register.py --file ./register.csv --dry-run
    python scripts/import_sponsor_register.py --file ./register.csv --validate

    # Ingest a CSV you already have
    python scripts/import_sponsor_register.py --file ./worker-register.csv

    # Show exactly the rows the importer would send as batch 552, with their
    # payload sizes. Read-only: no credentials needed, nothing is written.
    python scripts/import_sponsor_register.py --file ./register.csv --inspect-batch 552

    # Download the current edition from GOV.UK and ingest it
    python scripts/import_sponsor_register.py

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (or in
apps/api/.env) unless --dry-run is used. Safe to run repeatedly: rows are keyed
by their register identity, so a second run over an unchanged file inserts
nothing.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.crawler.supabase_rest import SupabaseRest  # noqa: E402
from app.sponsors.importer import (  # noqa: E402
    UPSERT_CHUNK,
    RegisterValidationError,
    run_import,
)
from app.sponsors.inspection import BatchOutOfRange, render_batch  # noqa: E402
from app.sponsors.parser import (  # noqa: E402
    CsvParseError,
    decode_detail,
    deduplicate,
    parse_register_detail,
)
from app.sponsors.validation import build_report, render  # noqa: E402


def _validate(path: Path) -> int:
    """Parse and check the file, printing the report. Writes nothing."""
    try:
        text, encoding = decode_detail(path.read_bytes())
        parsed = parse_register_detail(text)
    except CsvParseError as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 3

    records, duplicates = deduplicate(parsed.records)
    report = build_report(
        file_name=path.name,
        encoding=encoding,
        header_line=parsed.header_line,
        header_row=parsed.header_row,
        column_map=parsed.column_map,
        records=records,
        rejections=parsed.rejections,
        data_lines=parsed.data_lines,
        duplicates=duplicates,
        # No database here, so the previous edition is unknown; the size
        # comparison runs during the real import, which can read it.
        previous_rows_parsed=None,
    )
    print(render(report))
    print("\n(nothing was written — this is a read-only check)")
    return 0 if report.ok else 1


def _inspect(path: Path, batch_number: int, chunk_size: int) -> int:
    """Print one batch of the file as the importer would send it. Writes nothing."""
    try:
        text, _encoding = decode_detail(path.read_bytes())
        parsed = parse_register_detail(text)
    except CsvParseError as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 3

    # Deduplicated, because that is the list the importer batches: batch numbers
    # only line up with a failing run if the same rows were dropped first.
    records, _duplicates = deduplicate(parsed.records)
    try:
        print(
            render_batch(
                records,
                batch_number,
                chunk_size=chunk_size,
                file_name=path.name,
                total_rows=parsed.data_lines,
            )
        )
    except BatchOutOfRange as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 2
    return 0


async def _ingest(path: Path | None, force: bool) -> int:
    settings = get_settings()
    if not (settings.supabase_url and settings.supabase_service_role_key):
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.", file=sys.stderr)
        return 2

    rest = SupabaseRest(settings.supabase_url, settings.supabase_service_role_key)
    csv_bytes = path.read_bytes() if path else None
    source_url = str(path) if path else None

    try:
        run_id, stats = await run_import(
            rest, csv_bytes=csv_bytes, source_url=source_url, force=force
        )
    except RegisterValidationError as exc:
        print(render(exc.report), file=sys.stderr)
        print(
            "\nImport REFUSED. Nothing was written and the stored register is "
            "unchanged.\nRe-run with --force only if you have inspected the "
            "file and the edition is genuinely this size.",
            file=sys.stderr,
        )
        return 4
    except CsvParseError as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 3

    print(f"import {run_id or '(unrecorded)'} finished")
    for key, value in stats.as_columns().items():
        print(f"  {key:16} {value}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, help="Ingest this CSV instead of downloading.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse, validate and report. Writes nothing.")
    parser.add_argument("--validate", action="store_true",
                        help="Alias of --dry-run; identical behaviour.")
    parser.add_argument("--force", action="store_true",
                        help="Import even if the safety checks fail. Only after "
                             "inspecting the validation report.")
    parser.add_argument("--inspect-batch", type=int, metavar="N",
                        help="Print the rows and payload sizes of import batch "
                             "N. Read-only: writes nothing, needs no credentials.")
    parser.add_argument("--batch-size", type=int, default=UPSERT_CHUNK,
                        metavar="N",
                        help=f"Batch size --inspect-batch numbers by "
                             f"(default {UPSERT_CHUNK}). Only change this if the "
                             f"failing run used a different SPONSOR_UPSERT_CHUNK.")
    parser.add_argument("--verbose", action="store_true", help="Debug logging.")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-8s %(name)s: %(message)s",
    )

    if args.inspect_batch is not None:
        if not args.file:
            print("--inspect-batch needs --file.", file=sys.stderr)
            return 2
        if not args.file.exists():
            print(f"No such file: {args.file}", file=sys.stderr)
            return 2
        if args.batch_size < 1:
            print("--batch-size must be at least 1.", file=sys.stderr)
            return 2
        return _inspect(args.file, args.inspect_batch, args.batch_size)

    if args.dry_run or args.validate:
        if not args.file:
            print("--dry-run/--validate needs --file.", file=sys.stderr)
            return 2
        if not args.file.exists():
            print(f"No such file: {args.file}", file=sys.stderr)
            return 2
        return _validate(args.file)

    return asyncio.run(_ingest(args.file, args.force))


if __name__ == "__main__":
    raise SystemExit(main())
