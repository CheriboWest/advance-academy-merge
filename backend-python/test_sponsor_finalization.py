"""Self-check for database-side sponsor-register finalization.

`python test_sponsor_finalization.py` — offline.

The 141,904-row import never reached a write batch. It died paging
`sponsor_licences` — offset 4000 of about 138 pages — because Python needed
every stored natural key to work out what to withdraw. The set difference is one
UPDATE in the database, and asking for it over HTTP a thousand rows at a time was
the whole problem.

Removing the prefetch also removes the only thing that made a partial import
safe to reason about, so these checks are mostly about the new rule: a batch
STAGES a row, only finalization PUBLISHES one, and a run that dies in between
must leave the previous edition exactly as authoritative as it was.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

import httpx

from app.sponsors.importer import (
    FINALIZE_CHUNK_SIZE,
    UPSERT_CHUNK,
    FinalizationFailed,
    run_import,
)
from fake_supabase import FakeSupabase, PostgrestError

HEADER = "Organisation Name,Town/City,County,Type & Rating,Route\n"

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{'ok  ' if cond else 'FAIL'}] {name}{('  ' + detail) if detail and not cond else ''}")


def csv_of(names: list[str]) -> bytes:
    body = "".join(
        f"{name},London,Greater London,Worker (A (Premium)),Skilled Worker\n"
        for name in names
    )
    return (HEADER + body).encode("utf-8")


def org_names(count: int, *, start: int = 0) -> list[str]:
    return [f"Org {i:06d} Ltd" for i in range(start, start + count)]


class FreshClient:
    """A short-lived client for the final status write."""

    def __init__(self, timeout: Optional[float] = None) -> None:
        self.timeout = timeout
        self.should_fail = False

    async def __aenter__(self) -> "FreshClient":
        return self

    async def __aexit__(self, *_exc: Any) -> bool:
        return False


def ingest(rest: FakeSupabase, payload: bytes, *, force: bool = True):
    return asyncio.run(
        run_import(
            rest, client=object(), csv_bytes=payload, source_url="edition.csv",
            force=force, sleeper=lambda _d: asyncio.sleep(0),
            client_factory=FreshClient,
        )
    )


def try_ingest(rest: FakeSupabase, payload: bytes, *, force: bool = True):
    """Ingest, returning the exception instead of raising it."""
    try:
        ingest(rest, payload, force=force)
        return None
    except Exception as exc:  # noqa: BLE001 — the test decides what it means
        return exc


# ---------------------------------------------------------------------------
# A — a six-figure table is never downloaded to decide what changed.
# ---------------------------------------------------------------------------
BIG = 138_000
seeded = [
    {
        "natural_key": f"key-{i}",
        "organisation_name": f"Seeded {i} Ltd",
        "normalized_name": f"seeded {i}",
        "is_current": True,
        "source_url": "old.csv",
    }
    for i in range(BIG)
]
rest = FakeSupabase(seeded)
ingest(rest, csv_of(org_names(3)))

check("A: the table really did start with six figures of rows", BIG == 138_000)
check("A: sponsor_licences is never paged during an import",
      rest.licence_selects == [], f"got {len(rest.licence_selects)} page(s)")
check("A: no read of the register table happens at all",
      not [r for r in rest.requests if r == "select:sponsor_licences"],
      f"got {[r for r in rest.requests if 'licences' in r][:3]}")
check("A: the only register traffic is the write and the finalize",
      {r for r in rest.requests if "licences" in r} == {"upsert:sponsor_licences"},
      f"got {sorted({r for r in rest.requests if 'licences' in r})}")
# Finalization is chunked, not one giant statement: with 138,000 stale rows to
# withdraw at FINALIZE_CHUNK_SIZE per call, that is roughly BIG / chunk calls
# (plus begin/promote/complete) — nowhere near one call per row, and nowhere
# near the single all-in-one call 0009 used.
expected_order_of_magnitude = BIG // FINALIZE_CHUNK_SIZE
check("A: finalization is chunked, not one call per row",
      len(rest.rpc_calls) < BIG, f"got {len(rest.rpc_calls)}")
check("A: ...and not the single giant call 0009 used, either",
      len(rest.rpc_calls) >= expected_order_of_magnitude,
      f"got {len(rest.rpc_calls)}, expected roughly {expected_order_of_magnitude}+")
check("A: no single chunk call ever exceeds the configured chunk size",
      all(
          call[1].get("p_limit", 0) <= FINALIZE_CHUNK_SIZE
          for call in rest.rpc_calls if "p_limit" in call[1]
      ),
      "a chunk call asked for more than FINALIZE_CHUNK_SIZE rows")
check("A: the import still succeeds against a full table",
      rest.status() == "success", f"got {rest.status()}")

# ---------------------------------------------------------------------------
# B — a new edition publishes its own rows and withdraws only the absent ones.
# ---------------------------------------------------------------------------
rest = FakeSupabase()
_, stats = ingest(rest, csv_of(["Acme Ltd", "Beta Ltd", "Gamma Ltd"]))
check("B: the first edition publishes every row",
      rest.current_names() == {"Acme Ltd", "Beta Ltd", "Gamma Ltd"},
      f"got {rest.current_names()}")
check("B: nothing is withdrawn on a first edition", stats.rows_withdrawn == 0)
check("B: rows_processed counts what was published", stats.rows_processed == 3,
      f"got {stats.rows_processed}")
check("B: rows_current_after describes the whole table",
      stats.rows_current_after == 3, f"got {stats.rows_current_after}")

_, stats = ingest(rest, csv_of(["Acme Ltd", "Beta Ltd", "Delta Ltd"]))
check("B: the second edition withdraws only the row it dropped",
      stats.rows_withdrawn == 1, f"got {stats.rows_withdrawn}")
check("B: the surviving rows stay current",
      rest.current_names() == {"Acme Ltd", "Beta Ltd", "Delta Ltd"},
      f"got {rest.current_names()}")
gamma = [r for r in rest.rows if r["organisation_name"] == "Gamma Ltd"][0]
check("B: the withdrawn row is kept, flagged and stamped",
      gamma["is_current"] is False and gamma["withdrawn_at"], f"got {gamma}")
check("B: withdrawn rows are never deleted", len(rest.rows) == 4,
      f"got {len(rest.rows)}")
check("B: the run records the deprecated counters as null, not zero",
      rest.imports[-1]["rows_inserted"] is None
      and rest.imports[-1]["rows_updated"] is None
      and rest.imports[-1]["rows_unchanged"] is None,
      f"got {rest.imports[-1]['rows_inserted']!r}")

# ---------------------------------------------------------------------------
# C — an import that dies halfway publishes nothing.
# ---------------------------------------------------------------------------
rest = FakeSupabase()
ingest(rest, csv_of(["Acme Ltd", "Beta Ltd", "Gamma Ltd"]))
# Gamma leaves the register, so a later edition withdraws it.
ingest(rest, csv_of(["Acme Ltd", "Beta Ltd"]))
authoritative = rest.current_names()
check("C: the setup withdrew Gamma", authoritative == {"Acme Ltd", "Beta Ltd"},
      f"got {authoritative}")

# Now an edition that brings Gamma back and adds Delta — and fails halfway.
# The poison sits in a LATER batch, so the first batch — which carries Gamma and
# Delta — really does land. That is the dangerous case: rows written, edition
# unfinished.
NEW = ["Gamma Ltd", "Delta Ltd"] + org_names(UPSERT_CHUNK * 2)
POISON = f"Org {UPSERT_CHUNK + 150:06d} Ltd"
rest.should_fail = lambda rows: any(
    r["organisation_name"] == POISON for r in rows
)
mark = len(rest.requests)
failure = try_ingest(rest, csv_of(NEW))
during = rest.requests[mark:]

check("C: the import fails", isinstance(failure, httpx.ReadTimeout),
      f"got {type(failure).__name__}")
check("C: some batches did land before it died",
      "upsert:sponsor_licences" in during)
check("C: it never called finalization",
      not [r for r in during if r.startswith("rpc:")],
      f"got {[r for r in during if r.startswith('rpc:')]}")
check("C: the previous edition is still the authoritative one",
      rest.current_names() == authoritative, f"got {rest.current_names()}")
check("C: nothing was withdrawn by the failed run",
      len([r for r in rest.rows if r["organisation_name"] in authoritative
           and not r["is_current"]]) == 0)
gamma = [r for r in rest.rows if r["organisation_name"] == "Gamma Ltd"][0]
check("C: a withdrawn licence is NOT reactivated by a partial write",
      gamma["is_current"] is False and gamma["withdrawn_at"],
      f"got is_current={gamma['is_current']}")
check("C: but the partial write did land, marked as this run's",
      gamma["staged_import_id"] == rest.imports[-1]["id"],
      f"got {gamma.get('staged_import_id')}")
delta = [r for r in rest.rows if r["organisation_name"] == "Delta Ltd"][0]
check("C: a brand-new row from a failed run is not live",
      delta["is_current"] is False, f"got {delta['is_current']}")
check("C: nor does it claim to belong to any edition",
      delta["last_import_id"] is None, f"got {delta['last_import_id']}")
check("C: the run is recorded as an error", rest.status() == "error",
      f"got {rest.status()}")
check("C: the failed run is not a usable edition",
      [i for i in rest.imports if i["status"] == "success"][-1]["id"]
      != rest.imports[-1]["id"])

# ---------------------------------------------------------------------------
# D — the rerun after that failure.
# ---------------------------------------------------------------------------
rest.should_fail = lambda rows: False
before = len(rest.rows)
_, stats = ingest(rest, csv_of(NEW))

check("D: the rerun succeeds", rest.status() == "success", f"got {rest.status()}")
check("D: no duplicate natural keys",
      len(rest.rows) == len({r["natural_key"] for r in rest.rows}))
# The failed run had staged some of the edition; the rerun must finish the rest
# rather than write a second copy of what already landed. Two extra rows are
# Acme and Beta, which this edition drops but never deletes.
check("D: the rerun only added the rows the failed run never reached",
      len(rest.rows) == len(NEW) + 2,
      f"{before} -> {len(rest.rows)}, expected {len(NEW) + 2}")
check("D: it did not re-create the rows the failed run had staged",
      len(rest.rows) < before * 2, f"{before} -> {len(rest.rows)}")
check("D: the current set is exactly the edition",
      rest.current_names() == set(NEW),
      f"missing {set(NEW) - rest.current_names()}")
check("D: Acme and Beta, absent from this edition, are withdrawn",
      not (rest.current_names() & {"Acme Ltd", "Beta Ltd"}))
check("D: rows_processed matches the edition", stats.rows_processed == len(NEW),
      f"got {stats.rows_processed}")
check("D: rows_current_after matches the edition",
      stats.rows_current_after == len(NEW), f"got {stats.rows_current_after}")
check("D: every published row carries this run's import id",
      all(r["last_import_id"] == rest.imports[-1]["id"] for r in rest.current()))

# ---------------------------------------------------------------------------
# E — withdrawal happens only on success. (C proves the negative; this proves
#     the same edition, run to completion, does withdraw.)
# ---------------------------------------------------------------------------
rest = FakeSupabase()
ingest(rest, csv_of(["Acme Ltd", "Beta Ltd", "Gamma Ltd"]))

rest.should_fail = lambda rows: True
try_ingest(rest, csv_of(["Acme Ltd"]))
check("E: a failed shrinking edition withdraws nothing",
      rest.current_names() == {"Acme Ltd", "Beta Ltd", "Gamma Ltd"},
      f"got {rest.current_names()}")

rest.should_fail = lambda rows: False
_, stats = ingest(rest, csv_of(["Acme Ltd"]))
check("E: the same edition, completed, withdraws the difference",
      stats.rows_withdrawn == 2 and rest.current_names() == {"Acme Ltd"},
      f"withdrawn={stats.rows_withdrawn} current={rest.current_names()}")
check("E: the withdrawn rows are still in the table", len(rest.rows) == 3)

# ---------------------------------------------------------------------------
# F — a licence that comes back.
# ---------------------------------------------------------------------------
_, stats = ingest(rest, csv_of(["Acme Ltd", "Beta Ltd"]))
beta = [r for r in rest.rows if r["organisation_name"] == "Beta Ltd"][0]
check("F: a reappearing licence becomes current again",
      beta["is_current"] is True, f"got {beta['is_current']}")
check("F: its withdrawal stamp is cleared", beta["withdrawn_at"] is None,
      f"got {beta['withdrawn_at']}")
check("F: it is credited to the edition that brought it back",
      beta["last_import_id"] == rest.imports[-1]["id"])
check("F: it was not duplicated to do so", len(rest.rows) == 3,
      f"got {len(rest.rows)}")
check("F: Gamma, still absent, stays withdrawn",
      "Gamma Ltd" not in rest.current_names())

# ---------------------------------------------------------------------------
# Guards the database applies, mirrored here so the importer's handling of them
# is exercised.
# ---------------------------------------------------------------------------
rest = FakeSupabase()
ingest(rest, csv_of(["Acme Ltd", "Beta Ltd"]))
empty = try_ingest(rest, HEADER.encode("utf-8"))
check("GUARD: an edition that stages nothing cannot publish",
      isinstance(empty, FinalizationFailed), f"got {type(empty).__name__}")
check("GUARD: the underlying database refusal is preserved as the cause",
      isinstance(empty.__cause__, PostgrestError), f"got {type(empty.__cause__)}")
check("GUARD: and it withdraws nothing",
      rest.current_names() == {"Acme Ltd", "Beta Ltd"},
      f"got {rest.current_names()}")
check("GUARD: the empty run is recorded as an error", rest.status() == "error")

# A finalization that times out is retried — it is idempotent.
rest = FakeSupabase()
rest.fail_rpc_times = 1
_, stats = ingest(rest, csv_of(["Acme Ltd", "Beta Ltd"]))
check("RETRY: a timed-out finalization is retried",
      rest.rpc_failures == 1 and rest.status() == "success",
      f"failures={rest.rpc_failures} status={rest.status()}")
check("RETRY: and the edition is published exactly once",
      rest.current_names() == {"Acme Ltd", "Beta Ltd"})

# ...but not forever.
rest = FakeSupabase()
rest.fail_rpc_times = 99
outcome = try_ingest(rest, csv_of(["Acme Ltd"]))
check("RETRY: a finalization that never succeeds fails the import",
      isinstance(outcome, FinalizationFailed), f"got {type(outcome).__name__}")
check("RETRY: the exhausted timeout is preserved as the cause",
      isinstance(outcome.__cause__, httpx.ReadTimeout),
      f"got {type(outcome.__cause__)}")
check("RETRY: nothing is published by it", rest.current() == [],
      f"got {len(rest.current())}")
check("RETRY: the run is recorded as an error", rest.status() == "error")

# Staging without an import id is refused outright.
class NoIdRest(FakeSupabase):
    async def insert(self, client, table, rows, prefer="return=representation",
                     timeout=None):
        if table == "sponsor_register_imports":
            return []
        return rows


rest = NoIdRest()
outcome = try_ingest(rest, csv_of(["Acme Ltd"]))
check("NO RUN ID: the import refuses to stage rows it could never publish",
      isinstance(outcome, RuntimeError), f"got {type(outcome).__name__}")
check("NO RUN ID: nothing was written", rest.rows == [])

print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL SPONSOR FINALIZATION TESTS PASSED")
