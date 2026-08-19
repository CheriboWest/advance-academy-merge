import * as React from "react";
import type { Metadata } from "next";

import { parseSearchFilters } from "@/lib/filters";
import { PageContainer } from "@/components/page-container";
import { SearchFilters } from "@/components/search-filters";
import { SearchResults } from "@/components/search-results";
import { SearchResultsSkeleton } from "@/components/search-results-skeleton";

export const metadata: Metadata = {
  title: "Search",
  description: "Search UK companies and jobs on CareerHub UK.",
};

// Data is fetched per request from Supabase, driven by URL search params.
export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const filters = parseSearchFilters(await searchParams);

  // Re-key the Suspense boundary on the active filters so the skeleton shows
  // on every filter change, not just the first load.
  const suspenseKey = JSON.stringify(filters);

  return (
    <PageContainer className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Search UK employers
        </h1>
        <p className="text-muted-foreground">
          Explore companies hiring across the UK and find your next role.
        </p>
      </header>

      <SearchFilters
        q={filters.q}
        location={filters.location}
        sector={filters.sector}
        sort={filters.sort}
        mode={filters.mode}
      />

      <React.Suspense key={suspenseKey} fallback={<SearchResultsSkeleton />}>
        <SearchResults filters={filters} />
      </React.Suspense>
    </PageContainer>
  );
}
