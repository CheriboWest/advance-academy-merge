import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  getCompanyNotes,
  getExistingDraft,
  getSponsoredCompanyContext,
} from "@/lib/coach";
import { getContacts } from "@/lib/contacts";
import { fetchActiveJobs } from "@/lib/queries";
import { getSponsorshipStatus } from "@/lib/sponsorship";
import { Button } from "@/components/ui/button";
import { CompanyContextCard } from "@/components/coach/company-context-card";
import { OpenJobsSection } from "@/components/coach/open-jobs-section";
import { OutreachResearchSummary } from "@/components/coach/outreach-research-summary";
import { OutreachComposer } from "@/components/coach/outreach-composer";

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
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
      >
        <Link href="/coach/outreach">
          <ArrowLeft className="size-4" />
          Back to outreach
        </Link>
      </Button>

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
