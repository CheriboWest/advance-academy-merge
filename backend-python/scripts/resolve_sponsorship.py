#!/usr/bin/env python3
"""Resolve companies against the sponsor register from the command line.

    # One company
    python scripts/resolve_sponsorship.py --company <uuid>

    # Re-resolve one company even if its conclusion is current
    python scripts/resolve_sponsorship.py --company <uuid> --force

    # Backfill: everything not yet checked, or stale since a register refresh
    python scripts/resolve_sponsorship.py --all --limit 200

Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY. Safe to run
repeatedly: companies with a current conclusion are skipped, and a repeat
resolution updates the existing rows rather than adding new ones.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.crawler.supabase_rest import SupabaseRest  # noqa: E402
from app.sponsors.worker import resolve_companies  # noqa: E402


async def _run(args: argparse.Namespace) -> int:
    settings = get_settings()
    missing = [
        name
        for name, value in (
            ("SUPABASE_URL", settings.supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", settings.supabase_service_role_key),
            ("ANTHROPIC_API_KEY", settings.anthropic_api_key),
        )
        if not value
    ]
    if missing:
        print(f"Missing environment variables: {', '.join(missing)}", file=sys.stderr)
        return 2

    rest = SupabaseRest(settings.supabase_url, settings.supabase_service_role_key)
    company_ids = [args.company] if args.company else None

    async with httpx.AsyncClient() as client:
        stats = await resolve_companies(
            client,
            rest,
            company_ids,
            api_key=settings.anthropic_api_key,
            model=settings.sponsor_resolver_model,
            timeout=settings.request_timeout,
            concurrency=args.concurrency,
            max_companies=args.limit,
            force=args.force,
        )

    for key, value in stats.as_dict().items():
        print(f"  {key:16} {value}")
    for error in stats.errors[:10]:
        print(f"  error: {error}")
    return 1 if stats.failed and not stats.resolved else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--company", help="Resolve this company id.")
    target.add_argument("--all", action="store_true",
                        help="Resolve companies that need it.")
    parser.add_argument("--limit", type=int, default=50, help="Maximum companies.")
    parser.add_argument("--concurrency", type=int, default=3,
                        help="Concurrent model requests.")
    parser.add_argument("--force", action="store_true",
                        help="Re-resolve even if the conclusion is current.")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-8s %(name)s: %(message)s",
    )
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
