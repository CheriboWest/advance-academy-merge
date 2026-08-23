#!/usr/bin/env python3
"""Run the sponsor-register importer from the command line.

    # Download the current edition from GOV.UK and ingest it
    python scripts/import_sponsor_register.py

    # Ingest a CSV you already have (an archived edition, or an offline run)
    python scripts/import_sponsor_register.py --file ./worker-register.csv

    # Parse and report without writing anything
    python scripts/import_sponsor_register.py --file ./register.csv --dry-run

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
from app.sponsors.importer import run_import  # noqa: E402
from app.sponsors.parser import decode, deduplicate, parse_register  # noqa: E402


def _dry_run(path: Path) -> int:
    records, rejections, data_lines = parse_register(decode(path.read_bytes()))
    records, duplicates = deduplicate(records)

    print(f"rows downloaded : {data_lines}")
    print(f"rows parsed     : {len(records)}")
    print(f"rows rejected   : {len(rejections) + duplicates} "
          f"({len(rejections)} unparseable, {duplicates} in-file duplicates)")
    for rejected in rejections[:20]:
        print(f"  line {rejected.line_number}: {rejected.reason} — {rejected.raw}")
    print("\nfirst 5 records:")
    for record in records[:5]:
        print(f"  {record.organisation_name} | {record.town_city} | "
              f"{record.licence_type or '-'} {record.rating or '-'} | {record.route}")
    print("\n(dry run — nothing was written)")
    return 0


async def _ingest(path: Path | None) -> int:
    settings = get_settings()
    if not (settings.supabase_url and settings.supabase_service_role_key):
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.", file=sys.stderr)
        return 2

    rest = SupabaseRest(settings.supabase_url, settings.supabase_service_role_key)
    csv_bytes = path.read_bytes() if path else None
    source_url = str(path) if path else None

    run_id, stats = await run_import(rest, csv_bytes=csv_bytes, source_url=source_url)
    print(f"import {run_id or '(unrecorded)'} finished")
    for key, value in stats.as_columns().items():
        print(f"  {key:16} {value}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, help="Ingest this CSV instead of downloading.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse and report without writing to the database.")
    parser.add_argument("--verbose", action="store_true", help="Debug logging.")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-8s %(name)s: %(message)s",
    )

    if args.dry_run:
        if not args.file:
            print("--dry-run needs --file.", file=sys.stderr)
            return 2
        return _dry_run(args.file)

    return asyncio.run(_ingest(args.file))


if __name__ == "__main__":
    raise SystemExit(main())
