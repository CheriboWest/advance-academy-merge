import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getSponsoredCompanyContext } from "@/lib/coach";
import { getContacts } from "@/lib/contacts";
import { fetchActiveJobs } from "@/lib/queries";
import { getSponsorshipStatus } from "@/lib/sponsorship";
import { getOutreachActivitiesForCompany } from "@/lib/outreach-activity";
import { Button } from "@/components/ui/button";
import { CompanyContextCard } from "@/components/coach/company-context-card";
import { SponsorshipCard } from "@/components/coach/sponsorship-card";
import { ContactsSection } from "@/components/coach/contacts-section";
import { OpenJobsSection } from "@/components/coach/open-jobs-section";
import { OutreachActivityList } from "@/components/coach/outreach-activity-list";

interface SponsoredCompanyPageProps {
  params: Promise<{ companyId: string }>;
}

export async function generateMetadata({
  params,
}: SponsoredCompanyPageProps): Promise<Metadata> {
  const { companyId } = await params;
  try {
    const company = await getSponsoredCompanyContext(companyId);
    return { title: company ? company.name : "Sponsored Companies" };
  } catch {
    return { title: "Sponsored Companies" };
  }
}

/**
 * A sponsored company's profile: overview, visa sponsorship, open jobs,
 * contacts, and outreach history. Coach-only (the workspace layout enforces
 * the session) — never reachable from a public/student-facing route, which
 * is also why this page can show contacts at all (see migration 0011 /
 * app/routers/contacts.py).
 *
 * No email generation or sending here by design — see the separate Outreach
 * flow (app/coach/(workspace)/outreach) for composing and sending; this page
 * only shows what's already been sent, read-only-ish (reply/follow-up/close/
 * notes actions, same OutreachActivityList component the Outreach dashboard
 * uses — not a second copy of that list logic).
 */
export default async function SponsoredCompanyPage({
  params,
}: SponsoredCompanyPageProps) {
  const { companyId } = await params;

  const company = await getSponsoredCompanyContext(companyId);
  if (!company) {
    notFound();
  }

  const [sponsorshipStatus, jobs, contacts, outreachActivities] = await Promise.all([
    getSponsorshipStatus(company.company_id),
    fetchActiveJobs(company.company_id),
    getContacts(company.company_id),
    getOutreachActivitiesForCompany(company.company_id),
  ]);

  return (
    <div className="space-y-6">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
      >
        <Link href="/coach/sponsored-companies">
          <ArrowLeft className="size-4" />
          Back to sponsored companies
        </Link>
      </Button>

      {/* Company overview */}
      <CompanyContextCard company={company} />

      {/* Visa sponsorship */}
      <SponsorshipCard
        companyId={company.company_id}
        initialStatus={sponsorshipStatus}
      />

      {/* Open jobs */}
      <OpenJobsSection jobs={jobs} />

      {/* Contacts */}
      <ContactsSection companyId={company.company_id} initialContacts={contacts} />

      {/* Outreach history */}
      <section className="space-y-4 rounded-sm border border-border bg-card p-6">
        <h3 className="text-lg">Outreach history</h3>
        <OutreachActivityList activities={outreachActivities} hideCompany />
      </section>
    </div>
  );
}
