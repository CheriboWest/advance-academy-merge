import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";

import { getSponsoredCompanies } from "@/lib/coach";
import { getContactCounts } from "@/lib/contacts";
import { getSponsorshipStatuses } from "@/lib/sponsorship";
import type {
  CompanySponsorshipStatusCompact,
  SponsoredCompanyRow,
} from "@/lib/types";
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
  //
  // Deliberately NOT awaited: these are two cross-service round trips to the
  // FastAPI backend, and awaiting them here held the whole page behind them —
  // the segment's loading.tsx skeleton stayed up for seconds while the cards
  // themselves had everything they needed from `companies` alone. Handed to
  // the list as promise props instead, so the grid paints immediately and the
  // badges/counts stream in behind it.
  //
  // `.catch` because neither helper is as total as its "never throws" contract
  // suggests: both guard only their `fetch`, while the
  // createSupabaseServerClient()/getSession() calls above it sit outside that
  // try. Unhandled, a rejection here would reach the browser as an unhandled
  // promise rejection instead of the empty map the list already renders fine.
  const companyIds = companies.map((company) => company.company_id);
  const sponsorshipStatuses: Promise<
    Record<string, CompanySponsorshipStatusCompact>
  > = getSponsorshipStatuses(companyIds).catch(() => ({}));
  const contactCounts: Promise<Record<string, number>> =
    getContactCounts(companyIds).catch(() => ({}));

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
