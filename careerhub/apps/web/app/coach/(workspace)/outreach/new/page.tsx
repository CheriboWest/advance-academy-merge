import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { getSponsoredCompanies } from "@/lib/coach";
import type { SponsoredCompanyRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { OutreachShell } from "@/components/coach/outreach-shell";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = {
  title: "New outreach",
};

/**
 * Step 1 of the Outreach flow. Reuses the same company set as Sponsored
 * Companies (getSponsoredCompanies) — nothing here duplicates that data.
 * Picking a company continues to /coach/outreach/[companyId] for contact
 * selection, research, AI generation, editing and sending.
 */
export default async function NewOutreachPage() {
  let companies: SponsoredCompanyRow[];

  try {
    companies = await getSponsoredCompanies();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return (
      <div className="space-y-4">
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
