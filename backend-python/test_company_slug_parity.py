"""The Python side of the company-slug parity check.

`public.companies.slug` is unique and shared by both halves of the app, so the
crawler (Python) and Interview Prep (TypeScript) must derive the same slug from
the same company name. The fixture is generated from this module; this check
asserts the module still agrees with it, so that changing the rule here without
regenerating — and porting — fails loudly instead of quietly creating a second
row for a company that already exists.

Run: python test_company_slug_parity.py
"""

from __future__ import annotations

import json

from repo_paths import REPO_ROOT

from app.crawler.normalize import company_slug

FIXTURE = REPO_ROOT / "backend" / "src" / "lib" / "company-slug.cases.json"

failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        failures.append(f"{name} {detail}".strip())
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


check(f"{FIXTURE.name} exists", FIXTURE.exists(), f"not found at {FIXTURE}")

if FIXTURE.exists():
    cases = json.loads(FIXTURE.read_text())["cases"]
    check("fixture is not empty", len(cases) > 0)
    for case in cases:
        actual = company_slug(case["name"])
        check(
            f"company_slug({case['name']!r}) == {case['slug']!r}",
            actual == case["slug"],
            f"got {actual!r}",
        )

print()
if failures:
    print(f"{len(failures)} FAILED:")
    for f in failures:
        print(f"  - {f}")
    raise SystemExit(1)
print(f"all {len(cases) + 2} checks passed")
