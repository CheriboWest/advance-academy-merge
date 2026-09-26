import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import {
  getCompanyNotes,
  getExistingDraft,
  getSponsoredCompanyContext,
} from "@/features/career-hub/lib/coach";
import { getContacts } from "@/features/career-hub/lib/contacts";
import { fetchActiveJobs } from "@/features/career-hub/lib/queries";
import { getSponsorshipStatus } from "@/features/career-hub/lib/sponsorship";
import { CompanyContextCard } from "@/features/career-hub/components/coach/company-context-card";
import { OpenJobsSection } from "@/features/career-hub/components/coach/open-jobs-section";
import { OutreachResearchSummary } from "@/features/career-hub/components/coach/outreach-research-summary";
import { OutreachComposer } from "@/features/career-hub/components/coach/outreach-composer";

interface OutreachCompanyPageProps {
  params: Promise<{ companyId: string }>;
}

export async function generateMetadata({
  params,
}: OutreachCompanyPageProps): Promise<Metadata> {
  const { companyId } = await params;
  try {
    const company = await getSponsoredCompanyContext(companyId);
    return { title: company ? `Outreach · ${company.name}` : "Outreach" };
  } catch {
    return { title: "Outreach" };
  }
}

/**
 * Steps 3-6 of the Outreach flow for one company: research context, AI
 * generation, manual editing, and sending. Reuses exactly the same data as
 * the Sponsored Company profile (company context, sponsorship status, open
 * jobs, contacts) plus the coach's own company notes — nothing here is a
 * second copy of that data or a second sponsorship check.
 */
export default async function OutreachCompanyPage({
  params,
}: OutreachCompanyPageProps) {
  const { companyId } = await params;

  const company = await getSponsoredCompanyContext(companyId);
  if (!company) {
    notFound();
  }

  const [sponsorshipStatus, jobs, contacts, companyNotes, draft] =
    await Promise.all([
      getSponsorshipStatus(company.company_id),
      fetchActiveJobs(company.company_id),
      getContacts(company.company_id),
      getCompanyNotes(company.company_id),
      getExistingDraft(company.company_id),
    ]);

  return (
    <div className="space-y-6">
      <BackLink href="/coach/outreach">Back to outreach</BackLink>

      {/* Research: company overview, hiring signals, open jobs, sponsorship, notes */}
      <CompanyContextCard company={company} />
      <OutreachResearchSummary
        companyId={company.company_id}
        sponsorshipStatus={sponsorshipStatus}
        companyNotes={companyNotes}
      />
      <OpenJobsSection jobs={jobs} />

      {/* Contact, generation, editing, sending */}
      <OutreachComposer
        companyId={company.company_id}
        company={company}
        sponsorshipStatus={sponsorshipStatus}
        openJobTitles={jobs.slice(0, 10).map((job) => job.title)}
        companyNotes={companyNotes}
        contacts={contacts}
        initialSubject={draft?.subject ?? ""}
        initialBody={draft?.body ?? ""}
        hasExistingDraft={Boolean(draft)}
      />
    </div>
  );
}
