"""Orchestrates the AI TEAM contacts import: read the workbook, snapshot the
relevant slice of the database, build a plan (app.contacts_import.plan), and
— only when not a dry run — execute it.

Writes are insert-only. Nothing an existing row already has is ever changed:
a matched company is left exactly as it was, and a "duplicate" contact/job is
skipped, never merged into or overwritten. That's what "no destructive
updates" means here — see plan.py's dedupe classes for the checks that
decide match-vs-create and create-vs-skip before any write happens.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Optional

import httpx

from app.contacts_import.clean import normalize_person_name
from app.contacts_import.plan import ImportPlan, build_plan
from app.contacts_import.workbook import read_all
from app.crawler.normalize import company_slug, content_hash
from app.crawler.supabase_rest import SupabaseRest

_CHUNK = 100


def _csv(values: Iterable[str]) -> str:
    return ",".join(values)


def _chunks(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


async def _select_companies_by_slug(
    client: httpx.AsyncClient, rest: SupabaseRest, slugs: list[str]
) -> dict[str, dict]:
    by_slug: dict[str, dict] = {}
    for chunk in _chunks(slugs, _CHUNK):
        if not chunk:
            continue
        rows = await rest.select(
            client, "companies", {"slug": f"in.({_csv(chunk)})", "select": "id,slug,name"}
        )
        for row in rows:
            by_slug[row["slug"]] = row
    return by_slug


async def _select_job_hashes(
    client: httpx.AsyncClient, rest: SupabaseRest, hashes: list[str]
) -> set[str]:
    existing: set[str] = set()
    for chunk in _chunks(hashes, _CHUNK):
        if not chunk:
            continue
        rows = await rest.select(
            client, "jobs", {"content_hash": f"in.({_csv(chunk)})", "select": "content_hash"}
        )
        existing.update(row["content_hash"] for row in rows)
    return existing


async def _select_existing_contacts(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    company_ids: list[str],
    id_to_slug: dict[str, str],
) -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
    """Existing (company_slug, email) and (company_slug, normalized_name)
    pairs, for every company this import might add a contact to — i.e.
    every already-matched company. A newly-created company has no prior
    contacts by definition, so it needs no lookup here."""
    emails: set[tuple[str, str]] = set()
    names: set[tuple[str, str]] = set()
    for chunk in _chunks(company_ids, _CHUNK):
        if not chunk:
            continue
        rows = await rest.select(
            client,
            "contacts",
            {"company_id": f"in.({_csv(chunk)})", "select": "company_id,full_name,email"},
        )
        for row in rows:
            slug = id_to_slug.get(row["company_id"])
            if not slug:
                continue
            if row.get("email"):
                emails.add((slug, row["email"].lower()))
            names.add((slug, normalize_person_name(row["full_name"])))
    return emails, names


async def build_plan_from_workbook(
    client: httpx.AsyncClient, rest: SupabaseRest, path: Path
) -> ImportPlan:
    """Read + snapshot + plan — the read-only half shared by --dry-run and a
    real import. See module docstring: this is the one code path both use."""
    agency_rows, company_rows = read_all(path)

    candidate_slugs = sorted(
        {
            company_slug(o.company.name)
            for o in (*agency_rows, *company_rows)
            if o.company.name
        }
    )
    candidate_hashes = [
        content_hash(company_slug(o.company.name), o.job.title, "")
        for o in (*agency_rows, *company_rows)
        if o.company.name and o.job
    ]

    existing_companies_by_slug = await _select_companies_by_slug(client, rest, candidate_slugs)
    existing_job_hashes = await _select_job_hashes(client, rest, candidate_hashes)

    id_to_slug = {row["id"]: slug for slug, row in existing_companies_by_slug.items()}
    matched_ids = list(id_to_slug.keys())
    existing_contact_emails, existing_contact_names = await _select_existing_contacts(
        client, rest, matched_ids, id_to_slug
    )

    return build_plan(
        agency_rows,
        company_rows,
        existing_companies_by_slug=existing_companies_by_slug,
        existing_contact_emails=existing_contact_emails,
        existing_contact_names=existing_contact_names,
        existing_job_hashes=existing_job_hashes,
    )


async def _insert_chunked(
    client: httpx.AsyncClient,
    rest: SupabaseRest,
    table: str,
    rows: list[dict],
    *,
    on_row_error,
) -> int:
    """Inserts in chunks of _CHUNK; a chunk that fails (e.g. a rare unique-
    constraint race) is retried row-by-row so one bad row can't drop the
    rest of the chunk. Returns the number of rows actually inserted."""
    inserted = 0
    for chunk in _chunks(rows, _CHUNK):
        try:
            result = await rest.insert(client, table, chunk)
            inserted += len(result)
        except httpx.HTTPStatusError:
            for row in chunk:
                try:
                    result = await rest.insert(client, table, [row])
                    inserted += len(result)
                except httpx.HTTPStatusError as exc:
                    on_row_error(row, exc)
    return inserted


async def execute_plan(client: httpx.AsyncClient, rest: SupabaseRest, plan: ImportPlan) -> dict:
    """Writes the plan: companies first, then jobs and contacts against the
    resulting slug -> id map. Returns a dict of failures (if any — normally
    empty), keyed by table, for the CLI to report; every failure also
    removes that row from the plan's "to create" list so the printed report
    reflects what was actually written, not merely attempted."""
    failures: dict[str, list[tuple[dict, str]]] = {"companies": [], "jobs": [], "contacts": []}

    slug_to_id: dict[str, str] = {m.slug: m.company_id for m in plan.companies_matched}

    if plan.companies_to_create:
        company_rows = [
            {"slug": c.slug, "name": c.name, "website": c.website}
            for c in plan.companies_to_create
        ]

        def _company_error(row: dict, exc: httpx.HTTPStatusError) -> None:
            failures["companies"].append((row, str(exc)))

        for chunk in _chunks(company_rows, _CHUNK):
            try:
                result = await rest.insert(client, "companies", chunk)
                for row in result:
                    slug_to_id[row["slug"]] = row["id"]
            except httpx.HTTPStatusError:
                for row in chunk:
                    try:
                        result = await rest.insert(client, "companies", [row])
                        slug_to_id[result[0]["slug"]] = result[0]["id"]
                    except httpx.HTTPStatusError as exc:
                        _company_error(row, exc)

    created_company_slugs = {c.slug for c in plan.companies_to_create if c.slug in slug_to_id}
    failed_company_slugs = {c.slug for c in plan.companies_to_create} - created_company_slugs

    if plan.jobs_to_create:
        job_rows = []
        skipped_for_company = []
        for j in plan.jobs_to_create:
            company_id = slug_to_id.get(j.company_slug)
            if not company_id:
                skipped_for_company.append(j)
                continue
            job_rows.append(
                {
                    "company_id": company_id,
                    "title": j.title,
                    "source_url": j.source_url,
                    "source_job_id": j.source_job_id,
                    "content_hash": j.content_hash,
                    "source": "manual_import_xlsx",
                    "is_active": True,
                }
            )
        for j in skipped_for_company:
            failures["jobs"].append(
                ({"title": j.title, "company_slug": j.company_slug},
                 "company failed to create; job skipped")
            )

        def _job_error(row: dict, exc: httpx.HTTPStatusError) -> None:
            failures["jobs"].append((row, str(exc)))

        await _insert_chunked(client, rest, "jobs", job_rows, on_row_error=_job_error)

    if plan.contacts_to_create:
        contact_rows = []
        skipped_for_company = []
        for c in plan.contacts_to_create:
            company_id = slug_to_id.get(c.company_slug)
            if not company_id:
                skipped_for_company.append(c)
                continue
            contact_rows.append(
                {
                    "company_id": company_id,
                    "full_name": c.full_name,
                    "job_title": c.job_title,
                    "phone": c.phone,
                    "email": c.email,
                    "linkedin_url": c.linkedin_url,
                    "notes": c.notes,
                }
            )
        for c in skipped_for_company:
            failures["contacts"].append(
                ({"full_name": c.full_name, "company_slug": c.company_slug},
                 "company failed to create; contact skipped")
            )

        def _contact_error(row: dict, exc: httpx.HTTPStatusError) -> None:
            failures["contacts"].append((row, str(exc)))

        await _insert_chunked(client, rest, "contacts", contact_rows, on_row_error=_contact_error)

    return {
        "failed_company_slugs": failed_company_slugs,
        "failures": failures,
    }


async def run(
    path: Path, *, dry_run: bool, supabase_url: str, supabase_service_role_key: str
) -> tuple[ImportPlan, Optional[dict]]:
    rest = SupabaseRest(supabase_url, supabase_service_role_key)
    async with httpx.AsyncClient(timeout=30.0) as client:
        plan = await build_plan_from_workbook(client, rest, path)
        if dry_run:
            return plan, None
        outcome = await execute_plan(client, rest, plan)
        return plan, outcome
