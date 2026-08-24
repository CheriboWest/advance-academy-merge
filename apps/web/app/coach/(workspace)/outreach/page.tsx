import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";

import { getOutreachCompanies } from "@/lib/coach";
import { getSponsorshipStatuses } from "@/lib/sponsorship";
import type { OutreachCompany } from "@/lib/types";
import { OutreachList } from "@/components/coach/outreach-list";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = {
  title: "Outreach",
};

export default async function OutreachPage() {
  let companies: OutreachCompany[];

  try {
    companies = await getOutreachCompanies();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return (
      <div className="space-y-4">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Draft AI-assisted outreach for any company.
          </p>
        </header>
        <EmptyState
          icon={TriangleAlert}
          title="We couldn't load companies"
          description={message}
        />
      </div>
    );
  }

  // One batched request for every company on the page — not one per company,
  // which an outreach list this size would otherwise turn into an N+1.
  const sponsorshipStatuses = await getSponsorshipStatuses(
    companies.map((company) => company.company_id)
  );

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Draft AI-assisted outreach for any company. Drafts are private to you.
        </p>
      </header>
      <OutreachList companies={companies} sponsorshipStatuses={sponsorshipStatuses} />
    </div>
  );
}
