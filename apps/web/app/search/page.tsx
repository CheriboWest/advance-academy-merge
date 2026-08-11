"use client";

import * as React from "react";

import { getCompaniesWithJobCounts } from "@/lib/mock-data";
import {
  SearchFilters,
  defaultFilters,
  type SearchFiltersValue,
} from "@/components/search-filters";
import { CompanyCard } from "@/components/company-card";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";

const allCompanies = getCompaniesWithJobCounts();

function applyFilters(filters: SearchFiltersValue) {
  const query = filters.query.trim().toLowerCase();

  const filtered = allCompanies.filter((company) => {
    const matchesQuery =
      query.length === 0 ||
      company.name.toLowerCase().includes(query) ||
      company.description.toLowerCase().includes(query) ||
      company.sector.toLowerCase().includes(query);

    const matchesLocation =
      filters.location === "all" || company.location === filters.location;

    const matchesSector =
      filters.sector === "all" || company.sector === filters.sector;

    return matchesQuery && matchesLocation && matchesSector;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (filters.sort) {
      case "jobs-desc":
        return b.openJobs - a.openJobs;
      case "name-asc":
        return a.name.localeCompare(b.name);
      case "score-desc":
      default:
        return b.leadScore - a.leadScore;
    }
  });

  return sorted;
}

export default function SearchPage() {
  const [filters, setFilters] =
    React.useState<SearchFiltersValue>(defaultFilters);

  // Filtering runs live as the user types; the search button is a no-op
  // affordance that simply reasserts the current filters.
  const results = React.useMemo(() => applyFilters(filters), [filters]);

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

      <SearchFilters value={filters} onChange={setFilters} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {results.length}{" "}
          {results.length === 1 ? "company" : "companies"} found
        </p>
      </div>

      {results.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {results.map((company) => (
            <CompanyCard key={company.id} company={company} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No companies match your filters"
          description="Try a different search term, or reset the location and sector filters to see every employer."
          action={
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setFilters(defaultFilters)}
            >
              Reset filters
            </Button>
          }
        />
      )}
    </PageContainer>
  );
}
