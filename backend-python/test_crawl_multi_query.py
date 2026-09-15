"""Self-check for multi-role crawls: `python test_crawl_multi_query.py` (no pytest).

The crawler form used to take one role and one city per click, so filling the
database meant typing a role, waiting, typing the next. Both fields now accept a
list (newlines and/or commas) and `run_crawl` walks the cross product.

The shape under test is deliberately narrow: nothing changed type. `query` is
still a plain `str` on the request model, in the `crawl_runs.query` column and
in `run_crawl`'s signature — all the multi-value behaviour lives in
`split_terms`. That is what keeps this change free of a migration, an API
version bump, or edits to any pre-existing test.

Covered here:
  1. `split_terms` itself — separators, blanks, dedupe, order.
  2. One pair behaves exactly as before (one fetch, no extra queries).
  3. N roles x M cities fetches every pair, once.
  4. Statistics accumulate across pairs, and the same role seen under two
     search terms still dedupes to one job row.
  5. One failing pair does NOT fail the run — the other pairs' work survives.
  6. A run where every pair fails IS an error.
  7. The staleness ceiling scales with the pair count, so a legitimately long
     multi-pair run is not reported as interrupted while it is still going.

Runs offline: a fake `SupabaseRest` stands in for the database and the job
sources are stubbed, so no network and no Supabase project are involved.
"""

from __future__ import annotations

import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key")

from datetime import datetime, timedelta, timezone  # noqa: E402

from app.crawler.normalize import split_terms  # noqa: E402
from app.routers.discover import _row_to_status  # noqa: E402
from crawl_test_support import (  # noqa: E402
    LIVE_CRAWL_RUNS_COLUMNS,
    FakeRest,
    check,
    crawled,
    failures,
    run_crawl_with,
)

RUN_ID = "33333333-3333-3333-3333-333333333333"


def recording_fetch(calls: list[tuple[str, str]], jobs_for=None):
    """A `_fetch_all` stub that records the (query, city) it was called with."""

    async def _fetch(client, settings, query, city, sources, stats):
        calls.append((query, city))
        return list(jobs_for(query, city) if jobs_for else [])

    return _fetch


# ---------------------------------------------------------------------------
# 1. The parser.
# ---------------------------------------------------------------------------
check("splits on newlines", split_terms("a\nb\nc") == ["a", "b", "c"])
check("splits on commas", split_terms("a, b, c") == ["a", "b", "c"])
check("splits on both at once", split_terms("a\nb, c") == ["a", "b", "c"])
check("trims surrounding whitespace", split_terms("  a  \n\t b ") == ["a", "b"])
check("drops blank lines and stray separators",
      split_terms("a\n\n,\n b ,,") == ["a", "b"])
check("dedupes while preserving the typed order",
      split_terms("b\na\nb") == ["b", "a"])
check("a single value is just itself", split_terms("software engineer")
      == ["software engineer"])
check("empty input yields no terms", split_terms("") == [])
check("whitespace-only input yields no terms", split_terms("  \n \n ") == [])
# Job titles routinely contain internal spaces and slashes; only newlines and
# commas may separate.
check("internal punctuation is not a separator",
      split_terms("QA / Test Engineer") == ["QA / Test Engineer"])

# ---------------------------------------------------------------------------
# 2. One pair: unchanged behaviour.
# ---------------------------------------------------------------------------
calls: list[tuple[str, str]] = []
rest = FakeRest(known_columns=LIVE_CRAWL_RUNS_COLUMNS)
run_crawl_with(rest, [], run_id=RUN_ID, fetch_all=recording_fetch(calls))
check("a single role still fetches exactly once", len(calls) == 1, f"got {calls}")
check("...with the query and city as typed",
      calls == [("software engineer", "London")], f"got {calls}")
check("...and reaches a terminal status",
      rest.crawl_runs[RUN_ID].get("status") == "success")

# ---------------------------------------------------------------------------
# 3. The cross product.
# ---------------------------------------------------------------------------
calls = []
rest = FakeRest(known_columns=LIVE_CRAWL_RUNS_COLUMNS)
run_crawl_with(rest, [], run_id=RUN_ID, fetch_all=recording_fetch(calls),
               query="Software Engineer\nData Analyst, DevOps Engineer",
               city="London")
check("three roles fetch three times", len(calls) == 3, f"got {calls}")
check("every role is crawled, in the order typed",
      [q for q, _ in calls] == ["Software Engineer", "Data Analyst",
                                "DevOps Engineer"], f"got {calls}")

calls = []
rest = FakeRest(known_columns=LIVE_CRAWL_RUNS_COLUMNS)
run_crawl_with(rest, [], run_id=RUN_ID, fetch_all=recording_fetch(calls),
               query="a, b", city="London, Manchester")
check("2 roles x 2 cities is 4 crawls", len(calls) == 4, f"got {calls}")
check("...covering every combination",
      set(calls) == {("a", "London"), ("a", "Manchester"),
                     ("b", "London"), ("b", "Manchester")}, f"got {calls}")

# ---------------------------------------------------------------------------
# 4. Statistics accumulate across pairs, and dedup still holds across them.
# ---------------------------------------------------------------------------
per_query = {
    "engineer": [crawled("Software Engineer", "Acme Ltd"),
                 crawled("Backend Developer", "ByteCorp")],
    "developer": [crawled("Software Engineer", "Acme Ltd"),   # same role, 2nd term
                  crawled("Platform Engineer", "ByteCorp")],
}
rest = FakeRest(known_columns=LIVE_CRAWL_RUNS_COLUMNS)
run_crawl_with(rest, [], run_id=RUN_ID,
               fetch_all=recording_fetch([], lambda q, c: per_query[q]),
               query="engineer, developer", city="London")
row = rest.crawl_runs[RUN_ID]
check("the run succeeds", row.get("status") == "success", f"got {row}")
check("statistics are the total across pairs, not just the last one",
      row.get("jobs_found") == 4, f"got {row.get('jobs_found')}")
check("a role found under two search terms is stored once",
      len(rest.jobs) == 3, f"got {[j.get('title') for j in rest.jobs]}")
check("companies are deduped across pairs too",
      sorted(c["slug"] for c in rest.companies) == ["acme", "bytecorp"],
      f"got {[c['slug'] for c in rest.companies]}")

# ---------------------------------------------------------------------------
# 5. One bad pair must not throw away the others. This is the whole point of
#    pasting twenty roles at once: a single typo cannot cost the other
#    nineteen.
# ---------------------------------------------------------------------------
async def flaky_fetch(client, settings, query, city, sources, stats):
    if query.startswith("bad"):
        raise RuntimeError("upstream blew up")
    return [crawled("Software Engineer", "Acme Ltd")]


rest = FakeRest(known_columns=LIVE_CRAWL_RUNS_COLUMNS)
run_crawl_with(rest, [], run_id=RUN_ID, fetch_all=flaky_fetch,
               query="good, bad", city="London")
row = rest.crawl_runs[RUN_ID]
check("a run with one failing pair still succeeds",
      row.get("status") == "success", f"got {row.get('status')}")
check("the working pair's jobs are still ingested", len(rest.jobs) == 1,
      f"got {rest.jobs}")
check("the failure is still reported to the coach",
      "bad" in (row.get("error_message") or ""), f"got {row.get('error_message')}")
check("the failure text never leaks upstream internals",
      "upstream blew up" not in (row.get("error_message") or ""),
      f"got {row.get('error_message')}")

# ---------------------------------------------------------------------------
# 6. ...but a run where nothing at all got through is a failure.
# ---------------------------------------------------------------------------
rest = FakeRest(known_columns=LIVE_CRAWL_RUNS_COLUMNS)
run_crawl_with(rest, [], run_id=RUN_ID, fetch_all=flaky_fetch,
               query="bad", city="London")
check("a run where every pair failed is an error",
      rest.crawl_runs[RUN_ID].get("status") == "error",
      f"got {rest.crawl_runs[RUN_ID].get('status')}")

rest = FakeRest(known_columns=LIVE_CRAWL_RUNS_COLUMNS)
run_crawl_with(rest, [], run_id=RUN_ID, fetch_all=flaky_fetch,
               query="bad\nbad-too", city="London")
check("...including when it was a multi-pair run",
      rest.crawl_runs[RUN_ID].get("status") == "error",
      f"got {rest.crawl_runs[RUN_ID].get('status')}")


# ---------------------------------------------------------------------------
# 7. The staleness ceiling scales with how much the run was asked to do.
#    Without this a legitimately running 8-pair crawl reports itself
#    interrupted after three minutes and the coach's page gives up on it.
# ---------------------------------------------------------------------------
def status_after(minutes: float, query: str, location: str = "London") -> str:
    started = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return _row_to_status({
        "id": RUN_ID,
        "status": "running",
        "query": query,
        "location": location,
        "started_at": started.isoformat(),
    }).status


check("a single-pair run is still reported interrupted after 5 minutes",
      status_after(5, "software engineer") == "error")
check("a single-pair run under the ceiling is still running",
      status_after(1, "software engineer") == "running")
check("an 8-pair run at 5 minutes is still running, not interrupted",
      status_after(5, "a, b, c, d", "London, Manchester") == "running")
check("an 8-pair run does eventually go stale",
      status_after(60, "a, b, c, d", "London, Manchester") == "error")
check("a run row with no query still gets a sane single-pair ceiling",
      status_after(5, "") == "error")

# ---------------------------------------------------------------------------
# 8. The endpoint: the cross-product cap, what gets stored, and the cache
#    branch. No network and no database — the Supabase wrapper, the cache
#    lookup and the background task are all stubbed, so what is exercised is
#    the router's own behaviour.
# ---------------------------------------------------------------------------
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import discover as discover_router  # noqa: E402


class _StubRest:
    async def select(self, client, table, params=None):
        return []

    async def insert(self, client, table, rows, prefer="return=representation"):
        return [{"id": RUN_ID}]


launched: list[dict] = []
fresh_pairs: set[tuple[str, str]] = set()


async def _stub_cached_refresh_time(client, rest, normalized_query, normalized_city):
    if (normalized_query, normalized_city) in fresh_pairs:
        return (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    return None


async def _stub_run_crawl(run_id, query, city, sources, force=False):
    launched.append({"query": query, "city": city, "force": force})


discover_router._require_supabase = lambda settings: _StubRest()
discover_router.cached_refresh_time = _stub_cached_refresh_time
discover_router.run_crawl = _stub_run_crawl
app.dependency_overrides[get_current_user] = lambda: "coach-1"
http = TestClient(app)


def start(query: str, city: str, force: bool = False):
    launched.clear()
    return http.post(
        "/discover/start",
        json={"query": query, "city": city, "sources": ["adzuna"], "force": force},
    )


res = start("Software Engineer\nData Analyst", "London")
check("a multi-role request is accepted", res.status_code == 200, res.text)
check("...and starts one run for the whole list", len(launched) == 1, f"{launched}")
check("...with the roles stored on one line",
      launched and launched[0]["query"] == "Software Engineer, Data Analyst",
      f"{launched}")

res = start("  ", "London")
check("an empty role list is rejected", res.status_code == 422, res.text)

res = start("a, b, c, d, e, f", "London, Manchester, Leeds, Bristol, Cardiff")
check("a cross product over the cap is rejected", res.status_code == 422, res.text)
check("...and the message says what the coach actually asked for",
      "30 crawls" in res.json()["detail"], res.text)
check("...and nothing was started", not launched, f"{launched}")

res = start("a, b, c, d, e", "London, Manchester, Leeds, Bristol, Cardiff")
check("a cross product exactly at the cap is accepted",
      res.status_code == 200, res.text)

# The cache branch: every pair fresh is nothing to crawl, which is the answer
# the single-pair case has always given.
fresh_pairs.update({("a", "london"), ("b", "london")})
res = start("a, b", "London")
check("a fully cached list returns the cached response",
      res.status_code == 200 and res.json()["cached"] is True, res.text)
check("...and starts no crawl", not launched, f"{launched}")
check("...reporting an age, from the stalest pair",
      res.json()["hours_ago"] == 3.0, res.text)
check("...with no per-pair job count to claim for a multi-pair list",
      res.json()["jobs_available"] is None, res.text)

# One stale pair makes it a real run — the loop skips the fresh ones itself.
res = start("a, b, c", "London")
check("a partially cached list is a real run",
      res.status_code == 200 and res.json()["cached"] is False, res.text)
check("...covering the whole list, so the loop can skip the fresh pairs",
      launched and launched[0]["query"] == "a, b, c", f"{launched}")

res = start("a, b", "London", force=True)
check("force bypasses the cache even when every pair is fresh",
      res.json()["cached"] is False, res.text)
check("...and the loop is told, so it does not re-skip them itself",
      launched and launched[0]["force"] is True, f"{launched}")

print()
if failures():
    print(f"{len(failures())} check(s) failed:")
    for f in failures():
        print(f"  - {f}")
    raise SystemExit(1)
print("All multi-query crawl checks passed.")
