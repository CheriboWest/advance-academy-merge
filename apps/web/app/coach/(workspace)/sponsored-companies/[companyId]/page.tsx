import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase } from "lucide-react";

import { getSponsoredCompanyContext } from "@/lib/coach";
import { getContacts } from "@/lib/contacts";
import { fetchActiveJobs } from "@/lib/queries";
import { getSponsorshipStatus } from "@/lib/sponsorship";
import { Button } from "@/components/ui/button";
import { CompanyContextCard } from "@/components/coach/company-context-card";
import { SponsorshipCard } from "@/components/coach/sponsorship-card";
import { ContactsSection } from "@/components/coach/contacts-section";
import { JobItem } from "@/components/job-item";
import { EmptyState } from "@/components/empty-state";

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
 * A sponsored company's profile: overview, visa sponsorship, open jobs, and
 * contacts. Coach-only (the workspace layout enforces the session) — never
 * reachable from a public/student-facing route, which is also why this page
 * can show contacts at all (see migration 0011 / app/routers/contacts.py).
 *
 * No email generation or sending here by design — see the separate Outreach
 * placeholder (app/coach/(workspace)/outreach) for that workflow.
 */
export default async function SponsoredCompanyPage({
  params,
}: SponsoredCompanyPageProps) {
  const { companyId } = await params;

  const company = await getSponsoredCompanyContext(companyId);
  if (!company) {
    notFound();
  }

  const [sponsorshipStatus, jobs, contacts] = await Promise.all([
    getSponsorshipStatus(company.company_id),
    fetchActiveJobs(company.company_id),
    getContacts(company.company_id),
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
      <section className="space-y-4 rounded-sm border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg">Open jobs</h3>
          <span className="label-caps tabular-nums text-muted-foreground">
            {jobs.length} live
          </span>
        </div>
        {jobs.length > 0 ? (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li key={job.id}>
                <JobItem job={job} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Briefcase}
            title="No open jobs right now"
            description="This company doesn't have any live roles at the moment."
          />
        )}
      </section>

      {/* Contacts */}
      <ContactsSection companyId={company.company_id} initialContacts={contacts} />
    </div>
  );
}
