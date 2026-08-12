import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";

import { getCoachCompanies } from "@/lib/coach";
import type { CoachCompanyRow } from "@/lib/types";
import { CompaniesTable } from "@/components/coach/companies-table";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = {
  title: "Companies",
};

export default async function CoachCompaniesPage() {
  let rows: CoachCompanyRow[];

  try {
    rows = await getCoachCompanies();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return (
      <div className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Companies</h2>
        </header>
        <EmptyState
          icon={TriangleAlert}
          title="We couldn't load your companies"
          description={message}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Star companies and keep private notes — visible only to you.
        </p>
      </header>
      <CompaniesTable rows={rows} />
    </div>
  );
}
