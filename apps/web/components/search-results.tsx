import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { fetchCompanies } from "@/lib/queries";
import type { SearchFiltersState } from "@/lib/filters";
import type { CompanySummary } from "@/lib/types";
import { CompanyCard } from "@/components/company-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

interface SearchResultsProps {
  filters: SearchFiltersState;
}

/**
 * Async server component that runs the Supabase query for the current filters
 * and renders the result grid, plus empty and error states. Wrapped in a
 * Suspense boundary by the page so a skeleton shows while it loads.
 */
export async function SearchResults({ filters }: SearchResultsProps) {
  let companies: CompanySummary[];

  try {
    companies = await fetchCompanies(filters);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return (
      <EmptyState
        icon={TriangleAlert}
        title="We couldn't load companies"
        description={message}
        action={
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/search">Try again</Link>
          </Button>
        }
      />
    );
  }

  if (companies.length === 0) {
    return (
      <EmptyState
        title="No companies match your filters"
        description="Try a different search term, or reset the location and sector filters to see every employer."
        action={
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/search">Reset filters</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {companies.length} {companies.length === 1 ? "company" : "companies"}{" "}
        found
      </p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {companies.map((company) => (
          <CompanyCard key={company.id} company={company} />
        ))}
      </div>
    </div>
  );
}
