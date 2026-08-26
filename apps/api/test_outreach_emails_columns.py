"""Regression test for "column outreach_emails.last_contacted_at does not
exist": `python test_outreach_emails_columns.py` (no pytest, no network, no
live database).

Same shape as test_public_company_summary_view.py, for outreach_emails
instead of public_company_summary. outreach_emails is a plain table (not a
view) that predates the migrations directory — see migration 0012's header
comment — so there is no full historical schema to parse out of the
migrations alone, only what they *add*. This test checks that every column
a frontend query references against outreach_emails is accounted for: either
part of the documented pre-migrations baseline (apps/web/lib/types.ts's
OutreachEmail interface says which those are) or declared by an
`add column if not exists` in some migration. It cannot confirm a migration
was actually applied to any particular live database — no test in this repo
can — but it does mean a query referencing a column no migration ever
declared, or a column silently dropped from what a migration adds, fails
here instead of shipping as a live "does not exist" error.
"""

from __future__ import annotations

import re
from pathlib import Path

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "infra/supabase/migrations"
WEB_ROOT = REPO_ROOT / "apps/web"

TABLE = "outreach_emails"

# Columns confirmed present before the migrations directory existed (see
# apps/web/lib/types.ts's OutreachEmail interface and migration 0012's
# header comment) — anything else must be explicitly added by a migration.
BASELINE_COLUMNS = {
    "id", "coach_user_id", "company_id", "recruiter_id",
    "subject", "body", "status", "sent_at", "created_at",
}

_COLUMN_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


# ---------------------------------------------------------------------------
# 1. Every column any migration adds to outreach_emails.
# ---------------------------------------------------------------------------

_ADD_COLUMN_RE = re.compile(
    r"alter\s+table\s+if\s+exists\s+public\." + TABLE + r"(.*?);",
    re.IGNORECASE | re.DOTALL,
)
_COLUMN_DECL_RE = re.compile(r"add\s+column\s+if\s+not\s+exists\s+(\w+)", re.IGNORECASE)


def migration_added_columns() -> set[str]:
    added: set[str] = set()
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        text = path.read_text()
        for block_match in _ADD_COLUMN_RE.finditer(text):
            added.update(_COLUMN_DECL_RE.findall(block_match.group(1)))
    return added


MIGRATION_COLUMNS = migration_added_columns()
KNOWN_COLUMNS = BASELINE_COLUMNS | MIGRATION_COLUMNS

check(
    "at least one migration adds columns to outreach_emails",
    bool(MIGRATION_COLUMNS),
    f"(none found under {MIGRATIONS_DIR})",
)
check(
    "the tracking columns the Outreach activity dashboard depends on are declared",
    {"contact_id", "recipient_email", "last_contacted_at", "follow_up_at", "notes"} <= KNOWN_COLUMNS,
    f"known columns: {sorted(KNOWN_COLUMNS)}",
)
print(f"    known columns (baseline + migrations): {sorted(KNOWN_COLUMNS)}")


# ---------------------------------------------------------------------------
# 2. Every column referenced by a frontend query against outreach_emails —
#    read (.eq/.neq/.order/.select) or write (.update({...})/.insert({...}),
#    including actions.ts's indirect updateActivity(activityId, {...})
#    helper) — must be in KNOWN_COLUMNS.
# ---------------------------------------------------------------------------

CHECKED_FILES = [
    WEB_ROOT / "lib/outreach-activity.ts",
    WEB_ROOT / "lib/coach.ts",
    WEB_ROOT / "app/coach/(workspace)/outreach/actions.ts",
]


def _object_literal_keys(braces_body: str) -> set[str]:
    return set(re.findall(r"(\w+)\s*:", braces_body))


def _extract_referenced_columns(source: str) -> set[str]:
    found: set[str] = set()

    for from_match in re.finditer(rf'\.from\(\s*"{TABLE}"\s*\)', source):
        window = source[from_match.end() : from_match.end() + 500]

        for call in re.finditer(r'\.(?:eq|neq|order|gte|lte|select)\(\s*"([^"]+)"', window):
            for part in call.group(1).split(","):
                part = part.strip()
                if part != "*" and _COLUMN_NAME_RE.match(part):
                    found.add(part)

        for obj_match in re.finditer(r"\.(?:update|insert)\(\s*\{([^}]*)\}", window, re.DOTALL):
            found.update(_object_literal_keys(obj_match.group(1)))

    # actions.ts's four action functions don't call .update({...}) directly —
    # they delegate to updateActivity(activityId, {...}), whose {...} is the
    # actual write payload, one .from("outreach_emails") away from where the
    # column names appear. Caught separately rather than widening the window
    # above to the point it could bleed into an unrelated call.
    for call_match in re.finditer(r"updateActivity\(\s*activityId\s*,\s*\{([^}]*)\}", source, re.DOTALL):
        found.update(_object_literal_keys(call_match.group(1)))

    return found


any_checked = False
for path in CHECKED_FILES:
    source = path.read_text()
    columns = _extract_referenced_columns(source)
    check(f"{path.relative_to(REPO_ROOT)}: at least one outreach_emails column reference found", bool(columns))
    if not columns:
        continue
    any_checked = True
    missing = sorted(c for c in columns if c not in KNOWN_COLUMNS)
    check(
        f"{path.relative_to(REPO_ROOT)}: every referenced outreach_emails column is known",
        not missing,
        f"references {missing} — not in {sorted(KNOWN_COLUMNS)}",
    )

check("at least one file's column references were actually checked", any_checked)


print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL OUTREACH_EMAILS COLUMN CHECKS PASSED")
