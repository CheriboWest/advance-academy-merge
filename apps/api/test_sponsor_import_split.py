"""Self-check for adaptive batch splitting in the sponsor-register import.

`python test_sponsor_import_split.py` — offline.

The real 141,904-row import reached batch 551/568 and then stuck: batch 552
timed out on all five attempts, and the PATCH that should have marked the run
`error` timed out too, on the same wedged connection. Retrying harder was not
the answer — the batch never went through. These checks cover the answer that
is: halve the batch until either the rows land or the chunk is small enough to
print every row in it, and record the run's fate on a connection of its own.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

import httpx

from fake_supabase import FakeSupabase
from app.sponsors.importer import (
    BATCH_MAX_ATTEMPTS,
    MIN_SPLIT_ROWS,
    STATUS_WRITE_ATTEMPTS,
    UPSERT_CHUNK,
    run_import,
)

HEADER = "Organisation Name,Town/City,County,Type & Rating,Route\n"
POOLED = object()  # the long-lived client the bulk upserts run on

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{'ok  ' if cond else 'FAIL'}] {name}{('  ' + detail) if detail and not cond else ''}")


def csv_of(rows: int) -> bytes:
    body = "".join(
        f"Org {i:05d} Ltd,London,Greater London,Worker (A (Premium)),Skilled Worker\n"
        for i in range(rows)
    )
    return (HEADER + body).encode("utf-8")


def timeout() -> httpx.ReadTimeout:
    return httpx.ReadTimeout("timed out", request=httpx.Request("POST", "https://x/y"))


# ---------------------------------------------------------------------------
# Doubles.
# ---------------------------------------------------------------------------
class FakeClient:
    """A short-lived client handed out by `ClientFactory`."""

    def __init__(self, factory: "ClientFactory", timeout: Optional[float]) -> None:
        self.factory = factory
        self.timeout = timeout
        self.closed = False

    async def __aenter__(self) -> "FakeClient":
        return self

    async def __aexit__(self, *_exc: Any) -> bool:
        self.closed = True
        return False


class ClientFactory:
    """Stands in for `httpx.AsyncClient`; can fail its first N clients."""

    def __init__(self, fail_first: int = 0) -> None:
        self.made: list[FakeClient] = []
        self.fail_first = fail_first

    def __call__(self, timeout: Optional[float] = None) -> FakeClient:
        client = FakeClient(self, timeout)
        self.made.append(client)
        return client


class SplitRest(FakeSupabase):
    """The shared double, with the upsert traffic recorded chunk by chunk.

    `should_fail(rows)` decides whether an upsert raises. The decision has to be
    made on the rows themselves: the splitter re-sends subsets of a batch, and a
    batch number would not survive the first split.
    """

    def __init__(
        self,
        should_fail: Any = lambda rows: False,
        *,
        commit_on_failure: bool = False,
    ) -> None:
        super().__init__()
        self.should_fail = should_fail
        self.commit_on_failure = commit_on_failure
        self.sent: list[int] = []          # row count of every upsert attempted
        self.succeeded: list[int] = []     # ...and of every one that landed

    async def upsert(self, client, table, rows, on_conflict, prefer="", timeout=None):
        self.sent.append(len(rows))
        result = await super().upsert(
            client, table, rows, on_conflict, prefer=prefer, timeout=timeout
        )
        self.succeeded.append(len(rows))
        return result

    async def update(self, client, table, match, values, prefer="", timeout=None):
        if isinstance(client, FakeClient) and client.factory.fail_first > 0:
            client.factory.fail_first -= 1
            self.update_clients.append(client)
            raise timeout_error()
        return await super().update(
            client, table, match, values, prefer=prefer, timeout=timeout
        )


timeout_error = timeout


class LogCapture:
    """Collects what the importer logged, so the failure path can be asserted."""

    def __init__(self) -> None:
        self.records: list[str] = []
        self.logger = logging.getLogger("careerhub.sponsors.importer")
        self.handler = logging.Handler()
        self.handler.emit = lambda record: self.records.append(record.getMessage())

    def __enter__(self) -> "LogCapture":
        # Without this the logger inherits the root's WARNING and the INFO
        # per-batch diagnostics never reach the handler at all.
        self.previous = self.logger.level
        self.logger.setLevel(logging.DEBUG)
        self.logger.addHandler(self.handler)
        return self

    def __exit__(self, *_exc: Any) -> bool:
        self.logger.removeHandler(self.handler)
        self.logger.setLevel(self.previous)
        return False

    @property
    def text(self) -> str:
        return "\n".join(self.records)


def ingest(rest: SplitRest, payload: bytes, factory: Optional[ClientFactory] = None):
    return asyncio.run(
        run_import(
            rest,
            client=POOLED,
            csv_bytes=payload,
            source_url="edition-A.csv",
            force=True,
            sleeper=lambda _d: asyncio.sleep(0),
            client_factory=factory or ClientFactory(),
        )
    )


def current_rows(rest: SplitRest) -> int:
    return len(rest.current())


def staged_rows(rest: SplitRest) -> int:
    return len(rest.rows)


def status(rest: SplitRest) -> str:
    return rest.imports[-1].get("status", "?")


# ---------------------------------------------------------------------------
# A — a full batch fails, its two halves succeed.
# ---------------------------------------------------------------------------
ROWS = 3 * UPSERT_CHUNK
rest = SplitRest(should_fail=lambda rows: len(rows) == UPSERT_CHUNK)
_, stats = ingest(rest, csv_of(ROWS))

half, other = UPSERT_CHUNK // 2, UPSERT_CHUNK - UPSERT_CHUNK // 2
check("A: the import succeeds", status(rest) == "success", f"got {status(rest)}")
check("A: the full batch was tried the whole retry budget first",
      rest.failures == 3 * BATCH_MAX_ATTEMPTS, f"got {rest.failures}")
check("A: each batch was split in two, and only in two",
      rest.succeeded == [half, other] * 3, f"got {rest.succeeded}")
check("A: the halves cover the batch exactly", half + other == UPSERT_CHUNK)
check("A: every row is stored", current_rows(rest) == ROWS, f"got {current_rows(rest)}")
check("A: no duplicate natural keys", len(rest.rows) == ROWS)
check("A: the split rows are still counted once", stats.rows_processed == ROWS,
      f"got {stats.rows_processed}")
check("A: nothing was withdrawn", stats.rows_withdrawn == 0)

# ---------------------------------------------------------------------------
# B — a half still fails, so it splits again.
# ---------------------------------------------------------------------------
rest = SplitRest(should_fail=lambda rows: len(rows) >= UPSERT_CHUNK // 2)
with LogCapture() as log:
    _, stats = ingest(rest, csv_of(UPSERT_CHUNK))

quarter = half // 2
check("B: the import still succeeds", status(rest) == "success", f"got {status(rest)}")
check("B: the halves were tried before being split further",
      rest.sent.count(half) > 1, f"got {rest.sent}")
check("B: it split a second time", max(rest.succeeded) <= quarter + 1,
      f"largest successful chunk {max(rest.succeeded)}")
check("B: every row is stored", current_rows(rest) == UPSERT_CHUNK,
      f"got {current_rows(rest)}")
check("B: no duplicates", len(rest.rows) == UPSERT_CHUNK)
check("B: the split is logged with the original batch number and the sizes",
      "batch 1/1 failed after" in log.text and f"splitting {UPSERT_CHUNK} →" in log.text,
      "split log line missing")
check("B: child batches are labelled under their parent",
      "batch 1A" in log.text and "batch 1B" in log.text)
check("B: grandchildren are labelled too", "batch 1AA" in log.text)
check("B: every batch logs its row range before it is sent",
      "range=0-" in log.text and "sending" in log.text)
check("B: every batch logs its first and last row",
      "first=" in log.text and "last=" in log.text)

# ---------------------------------------------------------------------------
# C — one row can never be written. Narrow to it, then fail safely.
# ---------------------------------------------------------------------------
POISON_INDEX = 137


def poisoned(rows: list[dict]) -> bool:
    return any(r.get("organisation_name") == f"Org {POISON_INDEX:05d} Ltd" for r in rows)


rest = SplitRest(should_fail=poisoned)
with LogCapture() as log:
    try:
        ingest(rest, csv_of(UPSERT_CHUNK))
        raised = False
    except httpx.ReadTimeout:
        raised = True

failed_sizes = sorted({n for n in rest.sent if n not in rest.succeeded})
smallest_failed = min(n for n in rest.sent if n not in rest.succeeded)
check("C: the import fails", raised)
check("C: it is recorded as an error", status(rest) == "error", f"got {status(rest)}")
check("C: splitting stopped at the floor, not before",
      smallest_failed <= MIN_SPLIT_ROWS, f"smallest failing chunk {smallest_failed}")
_floor_half = smallest_failed // 2
check("C: the chunk at the floor was not split any further",
      _floor_half not in rest.sent
      and (smallest_failed - _floor_half) not in rest.sent,
      f"sent {sorted(set(rest.sent))}")
check("C: the healthy rows before the bad one were written and kept",
      staged_rows(rest) > UPSERT_CHUNK // 2,
      f"got {staged_rows(rest)} of {UPSERT_CHUNK}")
check("C: the import stopped at the bad chunk instead of pressing on",
      staged_rows(rest) < UPSERT_CHUNK)
check("C: and none of what it staged became live",
      current_rows(rest) == 0, f"got {current_rows(rest)}")
check("C: the offending row is named in the log",
      f"Org {POISON_INDEX:05d} Ltd" in log.text)
check("C: its natural key is logged so it can be looked up",
      "natural_key=" in log.text and "could not be written" in log.text)
check("C: every row of the failing chunk is listed, not just the first",
      log.text.count("  row ") >= 2)
check("C: NOTHING was withdrawn",
      not [r for r in rest.rows if r.get("withdrawn_at")])
check("C: the failed run did not claim statistics",
      (rest.imports[-1].get("rows_current_after") or 0) == 0,
      f"got {rest.imports[-1].get('rows_current_after')}")
check("C: the failed run is not a usable edition",
      not [i for i in rest.imports if i.get("status") == "success"])

# A permanent error is still never split — it would fail identically forever.
def bad_request(rows) -> bool:
    return True


class PermanentRest(SplitRest):
    async def upsert(self, client, table, rows, on_conflict, prefer="", timeout=None):
        self.sent.append(len(rows))
        self.failures += 1
        request = httpx.Request("POST", "https://x/y")
        raise httpx.HTTPStatusError(
            "bad", request=request, response=httpx.Response(400, request=request)
        )


rest = PermanentRest()
with LogCapture() as log:
    try:
        ingest(rest, csv_of(UPSERT_CHUNK))
        raised = False
    except httpx.HTTPStatusError:
        raised = True
check("PERMANENT: a 400 fails immediately", raised and rest.failures == 1,
      f"attempts {rest.failures}")
check("PERMANENT: it is not split", rest.sent == [UPSERT_CHUNK], f"got {rest.sent}")
check("PERMANENT: the rows are still named", "could not be written" in log.text)
check("PERMANENT: nothing was withdrawn",
      not [r for r in rest.rows if r.get("withdrawn_at")])

# ---------------------------------------------------------------------------
# D — the parent committed before the client gave up.
# ---------------------------------------------------------------------------
rest = SplitRest(should_fail=lambda rows: len(rows) == UPSERT_CHUNK,
                 commit_on_failure=True)
_, stats = ingest(rest, csv_of(UPSERT_CHUNK))

check("D: the timed-out batch really did land server-side",
      rest.failures == BATCH_MAX_ATTEMPTS and rest.commit_on_failure)
check("D: the children write over it rather than duplicating it",
      len(rest.rows) == UPSERT_CHUNK, f"got {len(rest.rows)} rows")
check("D: every row is current exactly once", current_rows(rest) == UPSERT_CHUNK)
check("D: the import succeeds", status(rest) == "success")
check("D: nothing was withdrawn", stats.rows_withdrawn == 0)

# ---------------------------------------------------------------------------
# E — the failure has to be recorded on a connection of its own.
# ---------------------------------------------------------------------------
factory = ClientFactory(fail_first=1)
rest = SplitRest(should_fail=poisoned)
try:
    ingest(rest, csv_of(UPSERT_CHUNK), factory=factory)
except httpx.ReadTimeout:
    pass

check("E: the run still ends as error", status(rest) == "error", f"got {status(rest)}")
check("E: the status write did not reuse the stalled bulk connection",
      POOLED not in rest.update_clients, "the pooled client was used")
check("E: it retried on a NEW client after the first timed out",
      len(factory.made) == 2, f"made {len(factory.made)} clients")
check("E: the second client is a different object", factory.made[0] is not factory.made[1])
check("E: each short-lived client is closed", all(c.closed for c in factory.made))
check("E: the status client uses the short timeout, not the bulk one",
      all(c.timeout and c.timeout <= 60 for c in factory.made),
      f"timeouts {[c.timeout for c in factory.made]}")
check("E: the error detail survived", "ReadTimeout" in (rest.imports[-1].get("error") or ""))

# ...and it gives up rather than looping forever.
factory = ClientFactory(fail_first=99)
rest = SplitRest(should_fail=poisoned)
with LogCapture() as log:
    try:
        ingest(rest, csv_of(UPSERT_CHUNK), factory=factory)
    except httpx.ReadTimeout:
        pass
check("E: an unrecordable failure is bounded, not infinite",
      len(factory.made) == STATUS_WRITE_ATTEMPTS, f"made {len(factory.made)}")
check("E: and it is loud about the run row being stale",
      "FAILED to record status" in log.text)
check("E: the original failure is still raised, not replaced by the status error",
      "could not be written" in log.text)

# The success path takes the same route.
factory = ClientFactory()
rest = SplitRest()
ingest(rest, csv_of(UPSERT_CHUNK), factory=factory)
check("E: a successful run also records on a fresh client",
      status(rest) == "success" and POOLED not in rest.update_clients)

print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL SPONSOR IMPORT SPLIT TESTS PASSED")
