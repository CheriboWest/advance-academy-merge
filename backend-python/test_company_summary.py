"""Self-check for automated company summaries: `python test_company_summary.py`.

No pytest, no network, no Anthropic call. Exercises the pure logic in
app/companies/summarizer.py directly:
  - has_enough_data / fallback_summary, across the completeness levels the
    real data will actually produce (nothing at all, sector-or-location
    only, jobs, confirmed sponsorship) — the anti-hallucination fallback
    requirement 9 depends on these being right.
  - build_prompt, including that sponsorship is only mentioned when the
    resolved status is "licensed" (requirement 8: "only mention sponsorship
    if it is confirmed").
  - generate_and_store_summary's orchestration (enough-data gate, AI vs.
    fallback selection, fallback_on_error contract) against a fake
    SupabaseRest that never touches the network.
"""

from __future__ import annotations

import asyncio

from app.companies import summarizer
from app.companies.summarizer import (
    CompanySummaryContext,
    build_prompt,
    fallback_summary,
    has_enough_data,
)

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


def _context(**overrides) -> CompanySummaryContext:
    base = dict(
        company_id="c1",
        name="DGP Intelsius",
        sector=None,
        location=None,
        website_domain=None,
        open_jobs=0,
        job_titles=[],
        sponsorship_status=None,
        sponsorship_organisation_name=None,
    )
    base.update(overrides)
    return CompanySummaryContext(**base)


# ---------------------------------------------------------------------------
# has_enough_data / fallback_summary
# ---------------------------------------------------------------------------

bare = _context()
check("bare context (name only) has no enough data", not has_enough_data(bare))
check(
    "bare context's fallback names the gap, invents nothing",
    fallback_summary(bare) == "DGP Intelsius does not yet have enough information for a summary.",
)

sector_only = _context(sector="Technology")
check("sector alone counts as enough data", has_enough_data(sector_only))
check(
    "sector-only fallback mentions the sector, no location/jobs claim",
    fallback_summary(sector_only)
    == "DGP Intelsius operates in the Technology sector.",
)

location_only = _context(location="York")
check("location alone counts as enough data", has_enough_data(location_only))
check(
    "location-only fallback mentions the location",
    fallback_summary(location_only) == "DGP Intelsius is based in York.",
)

jobs_only = _context(open_jobs=1)
check("open jobs alone counts as enough data", has_enough_data(jobs_only))
jobs_only_summary = fallback_summary(jobs_only)
check(
    "single open job uses singular 'role'",
    "1 open role listed" in jobs_only_summary and "roles listed" not in jobs_only_summary,
)

full = _context(
    sector="Technology",
    location="York",
    open_jobs=3,
    job_titles=["Software Engineer", "QA Analyst"],
    sponsorship_status="licensed",
    sponsorship_organisation_name="DGP Intelsius Ltd",
)
full_summary = fallback_summary(full)
check(
    "full context combines location and sector in one sentence",
    "York-based company in the Technology sector" in full_summary,
)
check("full context mentions plural roles", "3 open roles listed" in full_summary)
check(
    "full context mentions the sponsor register only because status is licensed",
    "UK sponsor register" in full_summary and "DGP Intelsius Ltd" in full_summary,
)

unconfirmed = _context(sector="Technology", sponsorship_status="not_found")
check(
    "unconfirmed sponsorship is never mentioned in the fallback",
    "sponsor" not in fallback_summary(unconfirmed).lower(),
)

pending = _context(sector="Technology", sponsorship_status="pending_review")
check(
    "pending/not-yet-checked sponsorship is never mentioned either",
    "sponsor" not in fallback_summary(pending).lower(),
)


# ---------------------------------------------------------------------------
# build_prompt
# ---------------------------------------------------------------------------

prompt_full = build_prompt(full)
check("prompt includes the company name", "DGP Intelsius" in prompt_full)
check("prompt includes the sector", "Sector: Technology" in prompt_full)
check("prompt includes the location", "Location: York" in prompt_full)
check(
    "prompt includes job titles as hiring signal, for the model to generalise",
    "Software Engineer" in prompt_full and "QA Analyst" in prompt_full,
)
check(
    "prompt states sponsorship as confirmed, with the registered name",
    "Sponsorship: confirmed on the UK sponsor register" in prompt_full
    and "DGP Intelsius Ltd" in prompt_full,
)

prompt_unconfirmed = build_prompt(unconfirmed)
check(
    "prompt omits any sponsorship line when status isn't licensed",
    "Sponsorship" not in prompt_unconfirmed,
)

check(
    "system prompt instructs generalising titles into role types, not listing them",
    "Generalise job titles into role types" in summarizer.SYSTEM_PROMPT,
)
check(
    "system prompt forbids inventing facts",
    "never invent" in summarizer.SYSTEM_PROMPT.lower(),
)
check(
    "system prompt gates sponsorship mentions on explicit confirmation",
    "only if it is explicitly given as confirmed" in summarizer.SYSTEM_PROMPT,
)


# ---------------------------------------------------------------------------
# generate_and_store_summary — orchestration, against a fake SupabaseRest
# ---------------------------------------------------------------------------


class _FakeRest:
    """In-memory stand-in for SupabaseRest: only what load_context/store_summary
    touch (companies.select, jobs.select, companies.update)."""

    def __init__(self, company: dict, jobs: list[dict]):
        self.company = company
        self.jobs = jobs
        self.updates: list[dict] = []

    async def select(self, client, table, params=None, timeout=None):
        if table == "companies":
            return [self.company] if self.company else []
        if table == "jobs":
            return list(self.jobs)
        raise AssertionError(f"unexpected select on {table!r}")

    async def update(self, client, table, match, values, prefer="return=minimal", timeout=None):
        assert table == "companies"
        self.updates.append({"match": match, "values": values})
        self.company.update(values)
        return []


class _FakeClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False


def _run(coro):
    return asyncio.run(coro)


def _patch_sponsorship_status(status: str | None, org: str | None = None):
    async def _fake(client, rest, company_id):
        return {"status": status, "match": {"organisation_name": org} if org else {}}

    summarizer.company_sponsorship_status = _fake  # type: ignore[assignment]


_patch_sponsorship_status(None)

no_data_rest = _FakeRest(
    company={"id": "c1", "name": "Nameless Co", "sector": None, "region": None,
             "hq_location": None, "website": None, "ai_summary": None},
    jobs=[],
)
summary = _run(
    summarizer.generate_and_store_summary(
        _FakeClient(), no_data_rest, "c1",
        api_key=None, model="claude-sonnet-5", timeout=5.0, fallback_on_error=True,
    )
)
check(
    "no api key + no data: stores the template fallback, no crash",
    summary == "Nameless Co does not yet have enough information for a summary.",
)
check(
    "the fallback is actually persisted via update()",
    no_data_rest.updates
    and no_data_rest.updates[-1]["values"]["ai_summary"] == summary,
)
check(
    "storing a summary also stamps ai_summary_generated_at",
    bool(no_data_rest.updates[-1]["values"].get("ai_summary_generated_at")),
)

sparse_data_no_key_rest = _FakeRest(
    company={"id": "c2", "name": "Acme Ltd", "sector": "Retail", "region": "Leeds",
             "hq_location": "Leeds", "website": "https://acme.example", "ai_summary": None},
    jobs=[{"title": "Store Assistant"}],
)
summary2 = _run(
    summarizer.generate_and_store_summary(
        _FakeClient(), sparse_data_no_key_rest, "c2",
        api_key=None, model="claude-sonnet-5", timeout=5.0, fallback_on_error=True,
    )
)
check(
    "enough data but no API key configured: still uses the template, not an AI call",
    summary2 is not None and "Acme Ltd" in summary2 and "Leeds" in summary2,
)

missing_company_rest = _FakeRest(company=None, jobs=[])
summary3 = _run(
    summarizer.generate_and_store_summary(
        _FakeClient(), missing_company_rest, "does-not-exist",
        api_key=None, model="claude-sonnet-5", timeout=5.0, fallback_on_error=True,
    )
)
check("a company that doesn't exist returns None, not an error", summary3 is None)
check("no update is attempted for a missing company", not missing_company_rest.updates)


def _raising_ai_summary(context, *, api_key, model, timeout):
    raise RuntimeError("simulated Anthropic failure")


enough_data_rest = _FakeRest(
    company={"id": "c3", "name": "Beta Corp", "sector": "Fintech", "region": None,
             "hq_location": "Bristol", "website": None, "ai_summary": None},
    jobs=[{"title": "Analyst"}],
)
_real_generate_ai_summary = summarizer.generate_ai_summary
summarizer.generate_ai_summary = _raising_ai_summary  # type: ignore[assignment]
try:
    summary4 = _run(
        summarizer.generate_and_store_summary(
            _FakeClient(), enough_data_rest, "c3",
            api_key="fake-key", model="claude-sonnet-5", timeout=5.0,
            fallback_on_error=True,
        )
    )
    check(
        "AI failure + fallback_on_error=True: quietly falls back, never raises",
        summary4 is not None and "Beta Corp" in summary4,
    )

    raised = False
    try:
        _run(
            summarizer.generate_and_store_summary(
                _FakeClient(), enough_data_rest, "c3",
                api_key="fake-key", model="claude-sonnet-5", timeout=5.0,
                fallback_on_error=False,
            )
        )
    except RuntimeError:
        raised = True
    check(
        "AI failure + fallback_on_error=False: re-raises for the manual-refresh caller",
        raised,
    )
finally:
    summarizer.generate_ai_summary = _real_generate_ai_summary


print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL COMPANY SUMMARY TESTS PASSED")
