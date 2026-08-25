"""Self-check for the outreach prompt's structured context.

`python test_ai_outreach.py` — offline, no network, no Anthropic call.
Exercises `OutreachRequest` validation and `_build_user_prompt` directly, as
pure functions: the request/response Pydantic model and the prompt string it
produces are what this task actually changed (the Anthropic call itself,
error handling, and response parsing are untouched).
"""

from __future__ import annotations

from pydantic import ValidationError

from app.routers.ai import _build_user_prompt
from app.schemas import MAX_OUTREACH_JOB_TITLES, OutreachRequest

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


# ---------------------------------------------------------------------------
# A minimal request (company only, as the old composer always sent) still
# validates and produces a prompt with no contact/sponsorship/notes lines —
# backward compatible with every field this endpoint accepted before.
# ---------------------------------------------------------------------------
minimal = OutreachRequest(company_name="Acme Ltd", open_jobs=3, lead_score=60)
prompt = _build_user_prompt(minimal)

check("minimal request validates", True)
check("minimal prompt includes the company name", "Acme Ltd" in prompt)
check("minimal prompt has no recipient line", "Recipient name:" not in prompt)
check("minimal prompt has no sponsorship line", "Sponsorship:" not in prompt)
check("minimal prompt has no notes lines", "private notes" not in prompt)
check("minimal prompt has no open-role-titles line", "Open role titles:" not in prompt)

# ---------------------------------------------------------------------------
# A fully-populated request: every optional piece of context appears in the
# prompt, using the real values, not just company/contact names.
# ---------------------------------------------------------------------------
full = OutreachRequest(
    company_name="Acme Ltd",
    location="London",
    sector="Fintech",
    open_jobs=2,
    lead_score=85,
    open_job_titles=["Software Engineer", "Data Analyst"],
    contact_name="Jamie Lee",
    contact_role="Hiring Manager",
    sponsorship_status="licensed",
    sponsorship_organisation_name="Acme Intelsius Ltd",
    company_notes="Met their CTO at a careers fair in March.",
    contact_notes="Prefers concise emails; responded well to a cold email before.",
)
full_prompt = _build_user_prompt(full)

check("full prompt includes both job titles",
      "Software Engineer" in full_prompt and "Data Analyst" in full_prompt)
check("full prompt includes the recipient's name and role",
      "Recipient name: Jamie Lee" in full_prompt
      and "Recipient role: Hiring Manager" in full_prompt)
check("full prompt states the sponsor licence, with the matched entity name",
      "sponsor licence" in full_prompt and "Acme Intelsius Ltd" in full_prompt)
check("full prompt carries the company notes",
      "Met their CTO at a careers fair in March." in full_prompt)
check("full prompt carries the contact notes",
      "Prefers concise emails" in full_prompt)

# ---------------------------------------------------------------------------
# Sponsorship is included ONLY for "licensed" — every other status is either
# unconfirmed or a non-match, and the prompt must never hand the model
# something it could mistake for a positive claim.
# ---------------------------------------------------------------------------
for status in ("ambiguous", "no_match", "not_checked", "error", None):
    req = OutreachRequest(
        company_name="Acme Ltd",
        sponsorship_status=status,
        sponsorship_organisation_name="Should never appear",
    )
    rendered = _build_user_prompt(req)
    check(f"sponsorship_status={status!r} is omitted from the prompt",
          "Sponsorship:" not in rendered and "Should never appear" not in rendered,
          f"got prompt containing: {rendered!r}")

# ---------------------------------------------------------------------------
# A contact with a name but no role still personalises; a role alone (no
# name, shouldn't normally happen client-side, but the API must not crash)
# is simply not rendered as a recipient line.
# ---------------------------------------------------------------------------
name_only = _build_user_prompt(OutreachRequest(company_name="Acme Ltd", contact_name="Sam"))
check("a contact name with no role still renders the name",
      "Recipient name: Sam" in name_only and "Recipient role:" not in name_only)

role_only = _build_user_prompt(OutreachRequest(company_name="Acme Ltd", contact_role="CTO"))
check("a role with no name renders neither recipient line",
      "Recipient name:" not in role_only and "Recipient role:" not in role_only)

# ---------------------------------------------------------------------------
# open_job_titles is bounded — a company with many open roles doesn't grow
# the prompt (or the request) unboundedly.
# ---------------------------------------------------------------------------
try:
    OutreachRequest(
        company_name="Acme Ltd",
        open_job_titles=[f"Role {i}" for i in range(MAX_OUTREACH_JOB_TITLES + 1)],
    )
    check(f"open_job_titles over {MAX_OUTREACH_JOB_TITLES} is rejected", False,
          "no ValidationError was raised")
except ValidationError:
    check(f"open_job_titles over {MAX_OUTREACH_JOB_TITLES} is rejected", True)

at_cap = OutreachRequest(
    company_name="Acme Ltd",
    open_job_titles=[f"Role {i}" for i in range(MAX_OUTREACH_JOB_TITLES)],
)
check(f"exactly {MAX_OUTREACH_JOB_TITLES} open_job_titles is accepted",
      len(at_cap.open_job_titles) == MAX_OUTREACH_JOB_TITLES)

print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL AI OUTREACH PROMPT TESTS PASSED")
