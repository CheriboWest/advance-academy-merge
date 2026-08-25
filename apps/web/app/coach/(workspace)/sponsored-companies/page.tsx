import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";

import { getSponsoredCompanies } from "@/lib/coach";
import { getContactCounts } from "@/lib/contacts";
import { getSponsorshipStatuses } from "@/lib/sponsorship";
import type { SponsoredCompanyRow } from "@/lib/types";
import { SponsoredCompaniesList } from "@/components/coach/sponsored-companies-list";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = {
  title: "Sponsored Companies",
};

export default async function SponsoredCompaniesPage() {
  let companies: SponsoredCompanyRow[];

  try {
    companies = await getSponsoredCompanies();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return (
      <div className="space-y-4">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Visa sponsorship status, licence details, open jobs and contacts
            for every company.
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

  // Two batched requests for every company on the page — not one per
  // company, which a list this size would otherwise turn into an N+1.
  const companyIds = companies.map((company) => company.company_id);
  const [sponsorshipStatuses, contactCounts] = await Promise.all([
    getSponsorshipStatuses(companyIds),
    getContactCounts(companyIds),
  ]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Visa sponsorship status, licence details, open jobs and contacts
          for every company.
        </p>
      </header>
      <SponsoredCompaniesList
        companies={companies}
        sponsorshipStatuses={sponsorshipStatuses}
        contactCounts={contactCounts}
      />
    </div>
  );
}
