"""Turns extracted row candidates into a plan: which companies already
match, which need creating, which contacts/jobs get created vs. skipped as
duplicates, and every row that couldn't be handled safely.

Pure and deterministic — no I/O. `importer.py` supplies the DB snapshot
(existing companies/contacts/job hashes) and executes the plan; this module
only decides what *should* happen, which is exactly what makes --dry-run
and the real import share one code path: the plan built here is identical
either way, only whether it gets executed differs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.contacts_import.clean import normalize_person_name
from app.contacts_import.rows import AgencyRowOutcome, CompanyRowOutcome
from app.crawler.normalize import canonical_company_name, company_slug, content_hash

# No location data exists anywhere in this workbook (neither sheet has a
# city/location column), so every job's content_hash uses the same empty
# city as the crawler's own hash would for a cityless job — this is the
# mechanism that lets an imported job dedupe against one the crawler already
# found for the same company+title, not just against other imported rows.
_NO_CITY = ""


@dataclass
class CompanyToCreate:
    slug: str
    name: str
    website: Optional[str] = None
    source: str = ""  # "job_agencies" | "uk_companies", for the report only


@dataclass
class CompanyMatch:
    slug: str
    company_id: str
    name: str


@dataclass
class ContactToCreate:
    row_number: int
    company_slug: str
    full_name: str
    job_title: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    linkedin_url: Optional[str]
    notes: Optional[str]


@dataclass
class ContactSkipped:
    row_number: int
    company_slug: str
    full_name: str
    reason: str


@dataclass
class JobToCreate:
    row_number: int
    company_slug: str
    title: str
    source_url: Optional[str]
    source_job_id: Optional[str]
    content_hash: str


@dataclass
class JobSkipped:
    row_number: int
    company_slug: str
    title: str
    reason: str


@dataclass
class AmbiguousRow:
    sheet: str
    row_number: int
    reasons: list[str]


@dataclass
class ImportPlan:
    companies_matched: list[CompanyMatch] = field(default_factory=list)
    companies_to_create: list[CompanyToCreate] = field(default_factory=list)
    contacts_to_create: list[ContactToCreate] = field(default_factory=list)
    contacts_skipped: list[ContactSkipped] = field(default_factory=list)
    jobs_to_create: list[JobToCreate] = field(default_factory=list)
    jobs_skipped: list[JobSkipped] = field(default_factory=list)
    ambiguous_rows: list[AmbiguousRow] = field(default_factory=list)


class _CompanyResolver:
    """Resolves a raw company name to a slug, matching an existing company
    or staging exactly one create per unique slug — however many rows in
    the sheet mention it."""

    def __init__(self, existing_companies_by_slug: dict[str, dict]):
        self._existing = existing_companies_by_slug
        self._matched: dict[str, CompanyMatch] = {}
        self._to_create: dict[str, CompanyToCreate] = {}

    def resolve(self, name: str, website: Optional[str], source: str) -> str:
        slug = company_slug(name)
        if slug in self._existing:
            row = self._existing[slug]
            self._matched.setdefault(
                slug,
                CompanyMatch(slug=slug, company_id=row["id"], name=row.get("name", name)),
            )
        elif slug not in self._to_create:
            self._to_create[slug] = CompanyToCreate(
                slug=slug,
                name=canonical_company_name(name),
                website=website,
                source=source,
            )
        elif website and not self._to_create[slug].website:
            # A later row for the same not-yet-created company supplies a
            # website the first row didn't — fill it in, still a create,
            # never an update to anything already in the database.
            self._to_create[slug].website = website
        return slug

    @property
    def matched(self) -> list[CompanyMatch]:
        return list(self._matched.values())

    @property
    def to_create(self) -> list[CompanyToCreate]:
        return list(self._to_create.values())


class _ContactDeduper:
    """"Dedupe contacts by company+email, then company+normalized name" —
    checked in that order against both the database snapshot and every
    contact already staged earlier in this same run."""

    def __init__(
        self,
        existing_emails: set[tuple[str, str]],
        existing_names: set[tuple[str, str]],
    ):
        self._emails = set(existing_emails)
        self._names = set(existing_names)

    def is_duplicate(self, company_slug_value: str, email: Optional[str], full_name: str) -> Optional[str]:
        if email and (company_slug_value, email.lower()) in self._emails:
            return "duplicate email at this company"
        name_key = (company_slug_value, normalize_person_name(full_name))
        if name_key in self._names:
            return "duplicate name at this company"
        return None

    def register(self, company_slug_value: str, email: Optional[str], full_name: str) -> None:
        if email:
            self._emails.add((company_slug_value, email.lower()))
        self._names.add((company_slug_value, normalize_person_name(full_name)))


class _JobDeduper:
    def __init__(self, existing_hashes: set[str]):
        self._hashes = set(existing_hashes)

    def is_duplicate(self, digest: str) -> bool:
        return digest in self._hashes

    def register(self, digest: str) -> None:
        self._hashes.add(digest)


def build_plan(
    agency_rows: list[AgencyRowOutcome],
    company_rows: list[CompanyRowOutcome],
    *,
    existing_companies_by_slug: dict[str, dict],
    existing_contact_emails: set[tuple[str, str]],
    existing_contact_names: set[tuple[str, str]],
    existing_job_hashes: set[str],
) -> ImportPlan:
    plan = ImportPlan()
    companies = _CompanyResolver(existing_companies_by_slug)
    contacts = _ContactDeduper(existing_contact_emails, existing_contact_names)
    jobs = _JobDeduper(existing_job_hashes)

    for outcome in agency_rows:
        if outcome.ambiguous:
            plan.ambiguous_rows.append(
                AmbiguousRow("JOB AGENCIES UK", outcome.row_number, list(outcome.ambiguous))
            )
        if not outcome.company.name:
            continue

        slug = companies.resolve(outcome.company.name, outcome.company.website, "job_agencies")

        if outcome.job:
            digest = content_hash(slug, outcome.job.title, _NO_CITY)
            if jobs.is_duplicate(digest):
                plan.jobs_skipped.append(
                    JobSkipped(outcome.row_number, slug, outcome.job.title,
                               "duplicate (matches an existing job's content hash)")
                )
            else:
                jobs.register(digest)
                plan.jobs_to_create.append(
                    JobToCreate(
                        outcome.row_number, slug, outcome.job.title,
                        outcome.job.source_url, outcome.job.source_job_id, digest,
                    )
                )

        if outcome.contact:
            dup_reason = contacts.is_duplicate(slug, outcome.contact.email, outcome.contact.full_name)
            if dup_reason:
                plan.contacts_skipped.append(
                    ContactSkipped(outcome.row_number, slug, outcome.contact.full_name, dup_reason)
                )
            else:
                contacts.register(slug, outcome.contact.email, outcome.contact.full_name)
                plan.contacts_to_create.append(
                    ContactToCreate(
                        outcome.row_number, slug, outcome.contact.full_name,
                        outcome.contact.job_title, outcome.contact.phone,
                        outcome.contact.email, outcome.contact.linkedin_url,
                        outcome.contact.notes,
                    )
                )

    for outcome in company_rows:
        if outcome.ambiguous:
            plan.ambiguous_rows.append(
                AmbiguousRow("UK COMPANIES", outcome.row_number, list(outcome.ambiguous))
            )
        if not outcome.company.name:
            continue

        slug = companies.resolve(outcome.company.name, outcome.company.website, "uk_companies")

        if outcome.job:
            digest = content_hash(slug, outcome.job.title, _NO_CITY)
            if jobs.is_duplicate(digest):
                plan.jobs_skipped.append(
                    JobSkipped(outcome.row_number, slug, outcome.job.title,
                               "duplicate (matches an existing job's content hash)")
                )
            else:
                jobs.register(digest)
                plan.jobs_to_create.append(
                    JobToCreate(
                        outcome.row_number, slug, outcome.job.title,
                        outcome.job.source_url, outcome.job.source_job_id, digest,
                    )
                )

    plan.companies_matched = companies.matched
    plan.companies_to_create = companies.to_create
    return plan
