import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";

import { getSponsoredCompanies } from "@/lib/coach";
import type { SponsoredCompanyRow } from "@/lib/types";
import { OutreachShell } from "@/components/coach/outreach-shell";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = {
  title: "Outreach",
};

/**
 * Step 1 of the Outreach flow. Reuses the same company set as Sponsored
 * Companies (getSponsoredCompanies) — nothing here duplicates that data.
 * Picking a company continues to /coach/outreach/[companyId] for contact
 * selection, research, AI generation, editing and sending.
 */
export default async function OutreachPage() {
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
            Choose a company to start building personalised outreach.
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

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Choose a company to start building personalised outreach — research,
          generation, editing and sending all happen on the next page.
        </p>
      </header>
      <OutreachShell companies={companies} />
    </div>
  );
}
