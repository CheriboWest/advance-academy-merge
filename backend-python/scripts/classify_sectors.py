#!/usr/bin/env python3
"""Backfill companies.sector for every company that has none.

    python scripts/classify_sectors.py            # all unclassified companies
    python scripts/classify_sectors.py --limit 200  # try a small run first

Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY. One
Claude call per 50 companies (~150 calls for 7.5k, well under $1 on Haiku).
Safe to re-run: classified companies are skipped, and ones the model couldn't
place stay NULL for the next run.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.companies.sector import classify_and_store, unclassified  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.crawler.supabase_rest import SupabaseRest  # noqa: E402


async def _run(limit: int | None) -> int:
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
    seen = stored = 0
    after_id = None
    async with httpx.AsyncClient() as client:
        while limit is None or seen < limit:
            page_size = 500 if limit is None else min(500, limit - seen)
            companies = await unclassified(client, rest, after_id=after_id, limit=page_size)
            if not companies:
                break
            stored += await classify_and_store(
                client,
                rest,
                companies,
                api_key=settings.anthropic_api_key,
                model=settings.anthropic_model,
                timeout=settings.request_timeout,
            )
            seen += len(companies)
            after_id = companies[-1]["id"]
            print(f"classified {stored}/{seen}", flush=True)

    print(f"done: {stored} of {seen} companies got a sector")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=None, help="stop after this many companies")
    sys.exit(asyncio.run(_run(parser.parse_args().limit)))
