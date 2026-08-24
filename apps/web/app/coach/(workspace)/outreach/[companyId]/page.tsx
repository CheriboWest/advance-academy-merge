import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getCompanyContext, getExistingDraft } from "@/lib/coach";
import { getContacts } from "@/lib/contacts";
import { getSponsorshipStatus } from "@/lib/sponsorship";
import type { OutreachInput } from "@/lib/outreach";
import { Button } from "@/components/ui/button";
import { CompanyContextCard } from "@/components/coach/company-context-card";
import { OutreachWorkspace } from "@/components/coach/outreach-workspace";
import { SponsorshipCard } from "@/components/coach/sponsorship-card";

interface ComposerPageProps {
  params: Promise<{ companyId: string }>;
}

export async function generateMetadata({
  params,
}: ComposerPageProps): Promise<Metadata> {
  const { companyId } = await params;
  try {
    const company = await getCompanyContext(companyId);
    return { title: company ? `Outreach · ${company.name}` : "Outreach" };
  } catch {
    return { title: "Outreach" };
  }
}

export default async function OutreachComposerPage({
  params,
}: ComposerPageProps) {
  const { companyId } = await params;

  const company = await getCompanyContext(companyId);
  if (!company) {
    notFound();
  }

  const [draft, sponsorshipStatus, contacts] = await Promise.all([
    getExistingDraft(companyId),
    getSponsorshipStatus(company.company_id),
    getContacts(company.company_id),
  ]);

  const input: OutreachInput = {
    name: company.name,
    location: company.location === "—" ? null : company.location,
    sector: company.sector,
    openJobs: company.open_jobs,
    leadScore: company.lead_score,
  };

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

      <CompanyContextCard company={company} />

      <SponsorshipCard
        companyId={company.company_id}
        initialStatus={sponsorshipStatus}
      />

      <OutreachWorkspace
        companyId={company.company_id}
        input={input}
        initialSubject={draft?.subject ?? ""}
        initialBody={draft?.body ?? ""}
        hasExistingDraft={Boolean(draft)}
        initialContacts={contacts}
      />
    </div>
  );
}
