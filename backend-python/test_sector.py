"""Self-check for sector classification: `python test_sector.py`. Offline.

Covers what can go wrong without a network: trusting a model answer outside
the batch or outside SECTORS, and the Python list drifting from the public
filter's list (the filter is an exact match, so drift = a dead option).
"""

from __future__ import annotations

import json
import re

from repo_paths import CAREERHUB_DIR

from app.companies.sector import SECTORS, UNKNOWN, build_prompt, parse_sectors

failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        failures.append(f"{name} {detail}".strip())
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


batch = [
    {"id": "a", "name": "Monzo", "titles": ["Backend Engineer"]},
    {"id": "b", "name": "Hays", "titles": []},
    {"id": "c", "name": "Mystery Ltd", "titles": []},
]

prompt = build_prompt(batch)
check("prompt numbers companies from 1", "1. Monzo — Backend Engineer" in prompt, prompt)
check("prompt marks missing titles", "2. Hays — no job titles" in prompt, prompt)

answer = json.dumps(
    {
        "results": [
            {"n": 1, "sector": "Finance & Banking"},
            {"n": 2, "sector": "Recruitment & HR"},
            {"n": 3, "sector": UNKNOWN},
            {"n": 4, "sector": "Technology"},  # not in the batch
            {"n": 0, "sector": "Technology"},  # not in the batch
        ]
    }
)
got = parse_sectors(answer, batch)
check("in-batch answers map to company ids", got.get("a") == "Finance & Banking" and got.get("b") == "Recruitment & HR", str(got))
check("Unknown is stored as None", "c" in got and got["c"] is None, str(got))
check("out-of-batch numbers are dropped", set(got) == {"a", "b", "c"}, str(got))
check(
    "a sector outside SECTORS is None",
    parse_sectors(json.dumps({"results": [{"n": 1, "sector": "Finance"}]}), batch) == {"a": None},
)

filters = (CAREERHUB_DIR / "lib" / "filters.ts").read_text(encoding="utf-8")
block = re.search(r"SECTOR_OPTIONS = \[(.*?)\] as const", filters, re.DOTALL)
frontend = re.findall(r'"([^"]+)"', block.group(1)) if block else []
check("frontend SECTOR_OPTIONS matches SECTORS", tuple(frontend) == SECTORS, f"{frontend} != {list(SECTORS)}")

if failures:
    print(f"\n{len(failures)} failure(s)")
    raise SystemExit(1)
print("\nall sector checks passed")
