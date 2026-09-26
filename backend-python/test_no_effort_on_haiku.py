"""Self-check: `python test_no_effort_on_haiku.py`.

Every Claude call here defaults to claude-haiku-4-5, which rejects
`output_config.effort` with a 400. Commit 529fd47 removed it from the sponsor
resolver but missed AI outreach and the company summariser, which then failed
on every call. This scans app/ so the next call site can't reintroduce it.
If a call is ever moved to a model that takes `effort`, gate it on the model
and allowlist the file here.
"""

from __future__ import annotations

import pathlib
import re
import sys

ALLOWED: set[str] = set()
PATTERN = re.compile(r"""["']effort["']\s*:""")

offenders = [
    str(path)
    for path in sorted(pathlib.Path("app").rglob("*.py"))
    if str(path) not in ALLOWED and PATTERN.search(path.read_text(encoding="utf-8"))
]

if offenders:
    print("FAIL: output_config.effort is sent from:", *offenders, sep="\n  ")
    sys.exit(1)
print("ok: no Claude call sends output_config.effort")
