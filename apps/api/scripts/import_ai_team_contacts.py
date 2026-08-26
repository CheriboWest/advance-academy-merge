#!/usr/bin/env python3
"""One-off importer for "AI TEAM - CURRENT CONTACTS.xlsx" into the existing
companies/contacts/jobs schema.

    # Preview only — parses the workbook, matches/plans against the live
    # database, and prints exactly what an import would do. Writes nothing.
    python scripts/import_ai_team_contacts.py --file "AI TEAM - CURRENT CONTACTS.xlsx" --dry-run

    # Actually import.
    python scripts/import_ai_team_contacts.py --file "AI TEAM - CURRENT CONTACTS.xlsx" --import

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (or in
apps/api/.env) — both modes read the live database to match existing
companies/contacts/jobs and avoid duplicates; only --import also writes to
it.

--dry-run and --import share one code path (app.contacts_import.importer):
the plan --dry-run prints is exactly the plan --import would execute, so
there is nothing an import can do that the dry run didn't already show.

Safe to run more than once: everything is insert-only (matched companies,
duplicate contacts, and duplicate jobs are left exactly as they were — see
app/contacts_import/plan.py), and content-hash/email/name dedup means a
second run over the same file, or a run after a partial failure, creates
nothing that already exists.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.contacts_import.importer import run  # noqa: E402
from app.contacts_import.report import render  # noqa: E402


async def _main(path: Path, dry_run: bool) -> int:
    settings = get_settings()
    if not (settings.supabase_url and settings.supabase_service_role_key):
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.", file=sys.stderr)
        return 2

    plan, outcome = await run(
        path,
        dry_run=dry_run,
        supabase_url=settings.supabase_url,
        supabase_service_role_key=settings.supabase_service_role_key,
    )
    print(render(plan, dry_run=dry_run, outcome=outcome, source_file=str(path)))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", type=Path, required=True, help="Path to the .xlsx workbook.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Plan and report only. Writes nothing.")
    mode.add_argument("--import", dest="do_import", action="store_true", help="Actually write the plan.")
    args = parser.parse_args()

    if not args.file.exists():
        print(f"No such file: {args.file}", file=sys.stderr)
        return 2

    return asyncio.run(_main(args.file, dry_run=not args.do_import))


if __name__ == "__main__":
    raise SystemExit(main())
