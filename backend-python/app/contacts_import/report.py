"""Renders an ImportPlan (and, for a real run, its execution outcome) as the
text the CLI prints — the same shape for --dry-run and a real import, since
they share one plan; only the closing line differs."""

from __future__ import annotations

from app.contacts_import.plan import ImportPlan


def render(plan: ImportPlan, *, dry_run: bool, outcome: dict | None, source_file: str) -> str:
    lines: list[str] = []
    mode = "DRY RUN — nothing will be written" if dry_run else "IMPORT"
    lines.append(f"AI TEAM CONTACTS IMPORT — {mode}")
    lines.append(f"Source: {source_file}")
    lines.append("")

    created_slugs_failed = (outcome or {}).get("failed_company_slugs", set())
    company_failures = len((outcome or {}).get("failures", {}).get("companies", []))
    job_failures = len((outcome or {}).get("failures", {}).get("jobs", []))
    contact_failures = len((outcome or {}).get("failures", {}).get("contacts", []))

    lines.append("Companies")
    lines.append(f"  matched existing:  {len(plan.companies_matched)}")
    created = len(plan.companies_to_create) - len(created_slugs_failed)
    if dry_run:
        lines.append(f"  to create:         {len(plan.companies_to_create)}")
    else:
        lines.append(f"  created:           {created}")
        if company_failures:
            lines.append(f"  failed to create:  {company_failures}")

    lines.append("Contacts")
    if dry_run:
        lines.append(f"  to create:         {len(plan.contacts_to_create)}")
    else:
        lines.append(f"  created:           {len(plan.contacts_to_create) - contact_failures}")
        if contact_failures:
            lines.append(f"  failed to create:  {contact_failures}")
    lines.append(f"  skipped (dup):     {len(plan.contacts_skipped)}")

    lines.append("Jobs")
    if dry_run:
        lines.append(f"  to create:         {len(plan.jobs_to_create)}")
    else:
        lines.append(f"  created:           {len(plan.jobs_to_create) - job_failures}")
        if job_failures:
            lines.append(f"  failed to create:  {job_failures}")
    lines.append(f"  skipped (dup):     {len(plan.jobs_skipped)}")

    lines.append("")
    lines.append(f"Ambiguous rows: {len(plan.ambiguous_rows)}")

    by_sheet: dict[str, int] = {}
    for row in plan.ambiguous_rows:
        by_sheet[row.sheet] = by_sheet.get(row.sheet, 0) + 1
    for sheet, count in sorted(by_sheet.items()):
        lines.append(f"  {sheet}: {count}")

    if plan.ambiguous_rows:
        lines.append("")
        lines.append("--- Ambiguous rows (not imported — review manually) ---")
        for row in plan.ambiguous_rows:
            lines.append(f"[{row.sheet}] row {row.row_number}:")
            for reason in row.reasons:
                lines.append(f"    - {reason}")

    lines.append("")
    if dry_run:
        lines.append("Nothing was written — this is a dry run.")
        lines.append("Re-run without --dry-run to actually import.")
    else:
        lines.append("Import complete.")
        if company_failures or job_failures or contact_failures:
            lines.append(
                "Some rows failed to write (see counts above) — re-run is safe: "
                "already-imported rows dedupe against what's now in the database."
            )

    return "\n".join(lines)
