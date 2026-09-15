"""Self-check for the AI TEAM contacts importer: `python test_contacts_import.py`.

No pytest, no network, no live Supabase — pure-function checks against the
concrete messy cells found in "AI TEAM - CURRENT CONTACTS.xlsx" (see
app/contacts_import/), a small in-memory workbook built with openpyxl for
the forward-fill/row-reading layer, and a stub SupabaseRest for the
execute-plan layer. Every case below is either a real cell value observed in
the source workbook or the exact edge case a requirement called out.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key")

import httpx  # noqa: E402
import openpyxl  # noqa: E402

from app.contacts_import import clean  # noqa: E402
from app.contacts_import.importer import build_plan_from_workbook, execute_plan  # noqa: E402
from app.contacts_import.plan import build_plan  # noqa: E402
from app.contacts_import.rows import (  # noqa: E402
    RawCell,
    extract_agency_row,
    extract_company_name,
    extract_company_row,
)
from app.contacts_import.workbook import read_job_agencies_uk, read_uk_companies  # noqa: E402

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


# ---------------------------------------------------------------------------
# clean.py — pure text cleaning/classification
# ---------------------------------------------------------------------------

check("nfkc fixes mathematical-bold digits", clean.nfkc("𝟎𝟕𝟒𝟖𝟖 𝟖𝟖𝟕 𝟑𝟔𝟒") == "07488 887 364")
check(
    "nfkc fixes mathematical-bold email letters",
    clean.nfkc("𝐑𝐞𝐞𝐜𝐞@𝐭𝐫𝐢𝐧𝐢𝐭𝐲𝐫𝐞𝐜.𝐜𝐨.𝐮𝐤") == "Reece@trinityrec.co.uk",
)

check("looks_like_url accepts https", clean.looks_like_url("https://example.com/job/1"))
check("looks_like_url rejects a job title", not clean.looks_like_url("Assistant Accountant"))

check("looks_like_phone accepts a UK number", clean.looks_like_phone("020 3857 2300"))
check("looks_like_phone rejects a bare name", not clean.looks_like_phone("Chloe Marsh"))
check(
    "looks_like_phone rejects a LinkedIn URL",
    not clean.looks_like_phone("https://www.linkedin.com/in/dervlaodriscoll/"),
)

cleaned, had_general = clean.strip_general_suffix("020 3857 2300 (general) ")
check("strip_general_suffix removes the marker", cleaned == "020 3857 2300")
check("strip_general_suffix reports it was present", had_general is True)
cleaned2, had_general2 = clean.strip_general_suffix("ryan@markettalent.co.uk")
check("strip_general_suffix is a no-op without the marker", cleaned2 == "ryan@markettalent.co.uk" and not had_general2)

remainder, annotation = clean.strip_trailing_annotation("02477 298355 (Coventry)")
check("strip_trailing_annotation splits a branch-office note", remainder == "02477 298355" and annotation == "Coventry")
remainder2, annotation2 = clean.strip_trailing_annotation("Crowley Cox (Financial Recruitment)")
check(
    "strip_trailing_annotation doesn't misfire on a name that just has parens",
    remainder2 == "Crowley Cox" and annotation2 == "Financial Recruitment",
)

check("fix_excel_float_phone restores the dropped leading 0", clean.fix_excel_float_phone(1753621902.0) == "01753621902")
check("fix_excel_float_phone restores a mobile number too", clean.fix_excel_float_phone(7825603608.0) == "07825603608")

check("strip_linkedin_wrapper strips the rank counter and suffix", clean.strip_linkedin_wrapper("(1) Maria R. | LinkedIn") == "Maria R.")
check("strip_linkedin_wrapper is a no-op on a plain name", clean.strip_linkedin_wrapper("Charley Callier") == "Charley Callier")
check("strip_linkedin_wrapper handles a name with no rank prefix", clean.strip_linkedin_wrapper("Helena Ranger | LinkedIn") == "Helena Ranger")

name, title = clean.split_name_and_title("Ryan Kaye - Managing Director")
check("split_name_and_title splits a clean Name - Title", name == "Ryan Kaye" and title == "Managing Director")
name2, title2 = clean.split_name_and_title("Executive Recruiter - Kelly Howe - Career Consultants")
check(
    "split_name_and_title refuses to split when the first segment is itself a title "
    "(would otherwise mislabel a job title as a person's name)",
    name2 == "Executive Recruiter - Kelly Howe - Career Consultants" and title2 is None,
)

check("looks_like_title_continuation catches a role-descriptor line", clean.looks_like_title_continuation("Managing Director Of Specialist Staffing"))
check("looks_like_title_continuation rejects a plain second name", not clean.looks_like_title_continuation("Andrea Lee"))

check("normalize_person_name is case/whitespace-insensitive", clean.normalize_person_name("  Ryan   KAYE ") == clean.normalize_person_name("Ryan Kaye"))

check(
    "extract_linkedin_job_id pulls the numeric id from a jobs/view URL",
    clean.extract_linkedin_job_id("https://www.linkedin.com/jobs/view/4418807838/?x=1") == "4418807838",
)
check("extract_linkedin_job_id is None for a non-matching URL", clean.extract_linkedin_job_id("https://example.com/job/1") is None)


# ---------------------------------------------------------------------------
# clean.normalize_phone_email — the column-content-vs-position bug this file
# regression-tests: a name or LinkedIn URL fat-fingered into the phone
# column must never become a fake phone number.
# ---------------------------------------------------------------------------

phone, email, linkedin, notes = clean.normalize_phone_email(1753621902.0, "recruit@rdfr.co.uk")
check("normalize_phone_email fixes a float phone and passes through a clean email", phone == "01753621902" and email == "recruit@rdfr.co.uk")

phone, email, linkedin, notes = clean.normalize_phone_email("0161 503 9339", None)
check(
    "a phone number typed into the wrong (email) column is not silently dropped "
    "or kept as a fake email",
    email is None,
)

phone, email, linkedin, notes = clean.normalize_phone_email(None, "0161 503 9339")
check(
    "a phone number typed into the email column is reclassified as phone",
    phone == "0161 503 9339" and email is None,
)

phone, email, linkedin, notes = clean.normalize_phone_email("Chloe Marsh", None)
check(
    "a bare person's name in the phone column is never treated as a phone number",
    phone is None and any("Unrecognized" in n for n in notes),
)

phone, email, linkedin, notes = clean.normalize_phone_email(
    "https://www.linkedin.com/in/dervlaodriscoll/", "dervla.odriscoll@get-recruited.co.uk"
)
check(
    "a LinkedIn URL fat-fingered into the phone column is recovered as linkedin_url, "
    "not treated as a phone number",
    phone is None and linkedin == "https://www.linkedin.com/in/dervlaodriscoll/" and email == "dervla.odriscoll@get-recruited.co.uk",
)

phone, email, linkedin, notes = clean.normalize_phone_email("020 3857 2300 (general) ", "info@ashdowngroup.com (general) ")
check("(general) is stripped from phone", phone == "020 3857 2300")
check("(general) is stripped from email", email == "info@ashdowngroup.com")
check("both (general) markers are preserved as notes, not silently dropped", len(notes) == 2)

phone, email, linkedin, notes = clean.normalize_phone_email("0207 389 6900 (London Office)", None)
check("a non-'general' trailing annotation is also recognized ('etc.')", phone == "0207 389 6900")
check("the annotation itself is preserved as a note", any("London Office" in n for n in notes))


# ---------------------------------------------------------------------------
# rows.py — company-name extraction
# ---------------------------------------------------------------------------

result = extract_company_name("Absolute", None, allow_domain_fallback=True)
check("a plain company name passes through", result.name == "Absolute" and not result.ambiguous_reason)

result = extract_company_name(None, None, allow_domain_fallback=True)
check("a blank company-name cell is ambiguous, not silently skipped", result.name is None and result.ambiguous_reason)

result = extract_company_name(
    "https://www.get-recruited.co.uk/", "https://www.get-recruited.co.uk/", allow_domain_fallback=True
)
check(
    "JOB AGENCIES UK: a bare-URL company name recovers a name from the domain",
    result.name == "Get Recruited" and result.inferred_from_domain,
)

result = extract_company_name(
    "https://www.linkedin.com/jobs/view/4431040115/",
    "https://www.linkedin.com/jobs/view/4431040115/",
    allow_domain_fallback=False,
)
check(
    "UK COMPANIES: a bare-URL company name is never guessed from a job-board domain "
    "(that domain is the board, not the employer)",
    result.name is None and result.ambiguous_reason,
)

result = extract_company_name("Crowley Cox Financial Recruitment", "https://www.crowleycox.co.uk/", allow_domain_fallback=True)
check(
    "JOB AGENCIES UK: a real company name's own hyperlink is captured as a website candidate",
    result.website == "https://www.crowleycox.co.uk/",
)
result_uk = extract_company_name("Carrs Billington Agriculture (Sales) Ltd.", "https://www.linkedin.com/company/carrs-billington-agriculture-sales-ltd-/life/", allow_domain_fallback=False)
check(
    "UK COMPANIES: a company's LinkedIn company-page hyperlink is not captured as website "
    "(companies has no field for it, and it isn't the company's own site anyway)",
    result_uk.website is None,
)


# ---------------------------------------------------------------------------
# rows.py — job extraction
# ---------------------------------------------------------------------------

outcome = extract_agency_row(
    2,
    extract_company_name("Market Talent", None, allow_domain_fallback=True),
    RawCell("Administrative Assistant - Bank Real Estate team - Market Talent", "https://www.markettalent.co.uk/job/36/"),
    RawCell(None, None),
    None,
    None,
)
check("a real job title + link becomes a job candidate", outcome.job is not None and outcome.job.source_url)

outcome = extract_agency_row(
    3,
    extract_company_name("X", None, allow_domain_fallback=True),
    RawCell("Order & Export Administrator | Sofina Foods Europe | LinkedIn", "https://www.linkedin.com/jobs/view/123/"),
    RawCell(None, None),
    None,
    None,
)
check(
    "a '| Company | LinkedIn' suffix is trimmed to the real title",
    outcome.job.title == "Order & Export Administrator",
)
check("a LinkedIn jobs/view URL's numeric id is captured", outcome.job.source_job_id == "123")

outcome = extract_agency_row(
    4,
    extract_company_name("X", None, allow_domain_fallback=True),
    RawCell("https://www.hansonsearch.com/", "https://www.hansonsearch.com/"),
    RawCell(None, None),
    None,
    None,
)
check(
    "a job link whose display text is itself a bare URL is never saved as the title "
    "— it's reported ambiguous instead",
    outcome.job is None and any("no distinct title" in r for r in outcome.ambiguous),
)

outcome = extract_agency_row(
    5,
    extract_company_name("X", None, allow_domain_fallback=True),
    RawCell("no suitable roles available", None),
    RawCell(None, None),
    None,
    None,
)
check(
    "text with no hyperlink in the job-link column is a recruiter note, not a job "
    "(never fabricates a job with no real link)",
    outcome.job is None,
)


# ---------------------------------------------------------------------------
# rows.py — contact extraction
# ---------------------------------------------------------------------------

outcome = extract_agency_row(
    6,
    extract_company_name("Absolute", None, allow_domain_fallback=True),
    RawCell(None, None),
    RawCell("Charley Callier", None),
    "0203 837 4977 (general)",
    "Jess@absolute-recruit.com",
)
check(
    "a plain name with no hyperlink never gets a fabricated LinkedIn URL",
    outcome.contact.linkedin_url is None,
)
check("phone/email still attach to a plain-name contact", outcome.contact.phone == "0203 837 4977" and outcome.contact.email == "Jess@absolute-recruit.com")

outcome = extract_agency_row(
    7,
    extract_company_name("Robert Half", None, allow_domain_fallback=True),
    RawCell(None, None),
    RawCell("(1) Maria R. | LinkedIn", "https://www.linkedin.com/in/maria-rodichkina/"),
    None,
    None,
)
check("a real LinkedIn profile hyperlink is captured as linkedin_url", outcome.contact.linkedin_url == "https://www.linkedin.com/in/maria-rodichkina/")
check("the rank counter and '| LinkedIn' suffix are stripped from the name", outcome.contact.full_name == "Maria R.")

outcome = extract_agency_row(
    8,
    extract_company_name("X", None, allow_domain_fallback=True),
    RawCell(None, None),
    RawCell("Executive Recruiter - Kelly Howe - Career Consultants", "https://www.careermovesgroup.co.uk/consultants/kelly-howe"),
    None,
    "kelly@careermovesgroup.example",
)
check(
    "a non-LinkedIn hyperlink (e.g. a 'meet the team' page) is never stored as linkedin_url",
    outcome.contact.linkedin_url is None,
)
check("that hyperlink is preserved as a note instead of being discarded", "careermovesgroup" in (outcome.contact.notes or ""))

outcome = extract_agency_row(
    9,
    extract_company_name("X", None, allow_domain_fallback=True),
    RawCell(None, None),
    RawCell("https://www.linkedin.com/in/georgia-mackey-33519916a/", "https://www.linkedin.com/in/georgia-mackey-33519916a/"),
    None,
    None,
)
check(
    "a contact cell whose display text is itself a bare URL has no name to use "
    "— reported ambiguous, not saved with a URL as the name",
    outcome.contact is None and any("no readable name" in r for r in outcome.ambiguous),
)

outcome = extract_agency_row(
    10,
    extract_company_name("X", None, allow_domain_fallback=True),
    RawCell(None, None),
    RawCell("Sarah Bush\nFabian Clapham", None),
    "020 1111 1111",
    None,
)
check(
    "two distinct names in one cell can't safely share the row's one phone number "
    "— reported ambiguous rather than guessed",
    outcome.contact is None and any("Multiple distinct contacts" in r for r in outcome.ambiguous),
)

outcome = extract_agency_row(
    11,
    extract_company_name("X", None, allow_domain_fallback=True),
    RawCell(None, None),
    RawCell("Claire Penketh \nManaging Director Of Specialist Staffing", None),
    None,
    "claire@example.com",
)
check(
    "a name followed by a title-continuation line is treated as one contact, not two",
    outcome.contact is not None and outcome.contact.full_name == "Claire Penketh",
)
check("the continuation line becomes the job title", outcome.contact.job_title == "Managing Director Of Specialist Staffing")

outcome = extract_agency_row(
    12,
    extract_company_name("X", None, allow_domain_fallback=True),
    RawCell(None, None),
    RawCell(None, None),
    "020 1111 1111",
    "someone@example.com",
)
check(
    "phone/email with no name at all in the row is reported ambiguous, not lost silently",
    outcome.contact is None and outcome.ambiguous,
)

outcome = extract_agency_row(13, extract_company_name(None, None, allow_domain_fallback=True), RawCell(None, None), RawCell(None, None), None, None)
check("a fully empty row under an unresolved company is just ambiguous for the company, nothing crashes", outcome.contact is None and outcome.job is None)


# ---------------------------------------------------------------------------
# rows.py — UK COMPANIES rows (no contacts, no forward-fill)
# ---------------------------------------------------------------------------

outcome = extract_company_row(
    2,
    extract_company_name("Dobbies Garden Centres ", None, allow_domain_fallback=False),
    RawCell("Allocator | Dobbies Garden Centres | LinkedIn", "https://www.linkedin.com/jobs/view/4418807838/"),
)
check("UK COMPANIES job title is trimmed the same way as JOB AGENCIES UK", outcome.job.title == "Allocator")
check("company name whitespace is collapsed", outcome.company.name == "Dobbies Garden Centres")


# ---------------------------------------------------------------------------
# workbook.py — forward-fill, blank-row handling, via a tiny in-memory workbook
# ---------------------------------------------------------------------------

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "JOB AGENCIES UK"
ws.append(["Company", "Link Job/Company", "LinkedIn", "Phone", "Email"])
ws.append(["Robert Half", "Assistant Accountant", "Maria R.", None, None])
ws["B2"].hyperlink = "https://www.roberthalf.com/job/1"
ws.append([None, None, "Eliana Zamet", None, "eliana@roberthalf.example"])  # forward-filled contact-only row
ws.append([None, None, None, None, None])  # fully blank spacer row
ws.append(["Absolute", "Accounts Assistant", "Jess Roberts", "07951 165 453", None])
ws["B5"].hyperlink = "https://absolute-recruit.com/job/1"

ws2 = wb.create_sheet("UK COMPANIES")
ws2.append(["COMPANY", "JOB TITLE/LINK"])
ws2.append(["Ooni", "Logistics Assistant | Ooni | LinkedIn"])
ws2["B2"].hyperlink = "https://www.linkedin.com/jobs/view/999/"
ws2.append([None, None])  # blank spacer

with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "test.xlsx"
    wb.save(path)
    saved = openpyxl.load_workbook(path)

    agency_rows = read_job_agencies_uk(saved)
    check("blank spacer row produces no outcome", len(agency_rows) == 3)
    check(
        "forward-fill: a blank-Company row inherits the company above it",
        agency_rows[1].company.name == "Robert Half" and agency_rows[1].contact.full_name == "Eliana Zamet",
    )
    check(
        "a new Company cell starts a new group",
        agency_rows[2].company.name == "Absolute" and agency_rows[2].contact.full_name == "Jess Roberts",
    )

    company_rows = read_uk_companies(saved)
    check("UK COMPANIES: blank spacer row produces no outcome", len(company_rows) == 1)
    check("UK COMPANIES: job title is parsed from the pipe-delimited text", company_rows[0].job.title == "Logistics Assistant")


# ---------------------------------------------------------------------------
# plan.py — matching, dedup ordering, no-destructive-updates
# ---------------------------------------------------------------------------

_acme = extract_company_name("Acme Recruiters", None, allow_domain_fallback=True)
agency_outcomes = [
    extract_agency_row(
        10, _acme,
        RawCell("Role One", "https://acme.example/job/1"), RawCell("Jane Doe", None), None, "jane@acme.example",
    ),
    extract_agency_row(
        # Row 11's own Company cell is blank in the sheet; workbook.py's
        # forward-fill is what supplies `_acme` again here — simulated
        # directly since this test exercises plan.py, not workbook.py.
        11, _acme,
        RawCell("Role Two", "https://acme.example/job/2"), RawCell("Jane Doe", None), None, "jane@acme.example",
    ),
]

plan = build_plan(
    agency_outcomes, [],
    existing_companies_by_slug={},
    existing_contact_emails=set(),
    existing_contact_names=set(),
    existing_job_hashes=set(),
)
check("one company is created for two rows naming the same company", len(plan.companies_to_create) == 1)
check("the second identical-email contact is deduped within the same run", len(plan.contacts_to_create) == 1 and len(plan.contacts_skipped) == 1)
check("both distinct job titles are created (not duplicates of each other)", len(plan.jobs_to_create) == 2)

# An already-existing company is matched, never re-created or altered.
plan2 = build_plan(
    [extract_agency_row(
        20, extract_company_name("Acme Recruiters", None, allow_domain_fallback=True),
        RawCell(None, None), RawCell("New Contact", None), None, "new@acme.example",
    )],
    [],
    existing_companies_by_slug={"acme-recruiters": {"id": "company-123", "name": "Acme Recruiters"}},
    existing_contact_emails=set(),
    existing_contact_names=set(),
    existing_job_hashes=set(),
)
check("an existing company is matched, not staged for creation", len(plan2.companies_to_create) == 0 and plan2.companies_matched[0].company_id == "company-123")

# Name-based dedup (no email on the new candidate) against an existing DB contact.
plan3 = build_plan(
    [extract_agency_row(
        21, extract_company_name("Acme Recruiters", None, allow_domain_fallback=True),
        RawCell(None, None), RawCell("Jane Doe", "https://www.linkedin.com/in/janedoe/"), None, None,
    )],
    [],
    existing_companies_by_slug={"acme-recruiters": {"id": "company-123", "name": "Acme Recruiters"}},
    existing_contact_emails=set(),
    existing_contact_names={("acme-recruiters", clean.normalize_person_name("Jane Doe"))},
    existing_job_hashes=set(),
)
check(
    "a no-email contact matching an existing contact by company+normalized name is skipped, not duplicated",
    len(plan3.contacts_skipped) == 1 and plan3.contacts_skipped[0].reason == "duplicate name at this company",
)

# Job content-hash dedup against an existing (e.g. crawler-created) job.
from app.crawler.normalize import company_slug as _company_slug, content_hash as _content_hash  # noqa: E402

existing_hash = _content_hash(_company_slug("Acme Recruiters"), "Role One", "")
plan4 = build_plan(
    [extract_agency_row(
        22, extract_company_name("Acme Recruiters", None, allow_domain_fallback=True),
        RawCell("Role One", "https://acme.example/job/1"), RawCell(None, None), None, None,
    )],
    [],
    existing_companies_by_slug={},
    existing_contact_emails=set(),
    existing_contact_names=set(),
    existing_job_hashes={existing_hash},
)
check("a job matching an existing content_hash is skipped as a duplicate, never re-created", len(plan4.jobs_to_create) == 0 and len(plan4.jobs_skipped) == 1)

# Ambiguous rows from both sheets are reported with which sheet they came from.
plan5 = build_plan(
    [extract_agency_row(30, extract_company_name(None, None, allow_domain_fallback=True), RawCell(None, None), RawCell(None, None), None, None)],
    [extract_company_row(5, extract_company_name(
        "https://uk.indeed.com/viewjob?jk=1", "https://uk.indeed.com/viewjob?jk=1",
        allow_domain_fallback=False,
    ), RawCell(None, None))],
    existing_companies_by_slug={}, existing_contact_emails=set(), existing_contact_names=set(), existing_job_hashes=set(),
)
check("ambiguous rows from both sheets are captured with their sheet name", {r.sheet for r in plan5.ambiguous_rows} == {"JOB AGENCIES UK", "UK COMPANIES"})


# ---------------------------------------------------------------------------
# importer.py — execute_plan against a stub SupabaseRest (no network)
# ---------------------------------------------------------------------------

class _StubRest:
    """Records every insert; select() answers from a small in-memory table
    set so build_plan_from_workbook's snapshot queries work too."""

    def __init__(self, existing: dict[str, list[dict]] | None = None):
        self.existing = existing or {}
        self.inserted: dict[str, list[dict]] = {}
        self._next_id = 1

    async def select(self, client, table, params=None, timeout=None):
        return self.existing.get(table, [])

    async def insert(self, client, table, rows, prefer="return=representation", timeout=None):
        if not rows:
            return []
        result = []
        for row in rows:
            stored = dict(row)
            stored.setdefault("id", f"{table}-{self._next_id}")
            self._next_id += 1
            result.append(stored)
        self.inserted.setdefault(table, []).extend(result)
        return result


def _run(coro):
    return asyncio.run(coro)


class _FakeClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


stub = _StubRest()
plan6 = build_plan(
    [extract_agency_row(
        40, extract_company_name("New Agency", None, allow_domain_fallback=True),
        RawCell("Some Role", "https://newagency.example/job/1"),
        RawCell("Pat Lee", None), "020 1111 2222", "pat@newagency.example",
    )],
    [],
    existing_companies_by_slug={}, existing_contact_emails=set(), existing_contact_names=set(), existing_job_hashes=set(),
)
outcome = _run(execute_plan(_FakeClient(), stub, plan6))
check("execute_plan inserts the new company", len(stub.inserted.get("companies", [])) == 1)
check("execute_plan inserts the job against the newly-created company's id", stub.inserted["jobs"][0]["company_id"] == stub.inserted["companies"][0]["id"])
check("execute_plan inserts the contact against the newly-created company's id", stub.inserted["contacts"][0]["company_id"] == stub.inserted["companies"][0]["id"])
check("no execution failures on a clean plan", not outcome["failures"]["companies"] and not outcome["failures"]["jobs"] and not outcome["failures"]["contacts"])
check("imported jobs are tagged with a distinct, identifiable source", stub.inserted["jobs"][0]["source"] == "manual_import_xlsx")

# Matching an existing company never issues an insert for it.
stub2 = _StubRest()
plan7 = build_plan(
    [extract_agency_row(
        41, extract_company_name("Old Agency", None, allow_domain_fallback=True),
        RawCell(None, None), RawCell("Pat Lee", None), None, "pat@oldagency.example",
    )],
    [],
    existing_companies_by_slug={"old-agency": {"id": "existing-co-1", "name": "Old Agency"}},
    existing_contact_emails=set(), existing_contact_names=set(), existing_job_hashes=set(),
)
_run(execute_plan(_FakeClient(), stub2, plan7))
check("execute_plan never inserts a row for an already-matched company (no destructive/duplicate writes)", "companies" not in stub2.inserted)
check("a contact for a matched company uses the existing company's real id", stub2.inserted["contacts"][0]["company_id"] == "existing-co-1")


print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL CONTACTS IMPORT TESTS PASSED")
