import * as React from "react";
import Link from "next/link";
import { Search, TriangleAlert } from "lucide-react";

import { fetchCompanies } from "@/lib/queries";
import { fetchCompaniesByRole } from "@/lib/role-search";
import type { SearchFiltersState } from "@/lib/filters";
import type { CompanyRoleResult, CompanySummary } from "@/lib/types";
import { CompanyCard } from "@/components/company-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

interface SearchResultsProps {
  filters: SearchFiltersState;
}

function ErrorState({ message }: { message: string }) {
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

function ResultsGrid({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {count} {count === 1 ? "company" : "companies"} found
      </p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">{children}</div>
    </div>
  );
}

/** Job Role Search: companies with active jobs matching the searched title. */
async function RoleResults({ filters }: SearchResultsProps) {
  // No role typed yet — prompt rather than implying an empty database.
  if (!filters.q.trim()) {
    return (
      <EmptyState
        icon={Search}
        title="Search for a job role"
        description="Enter a job title like “Marketing Executive” to find companies hiring for it."
      />
    );
  }

  let companies: CompanyRoleResult[];
  try {
    companies = await fetchCompaniesByRole(filters);
  } catch (error) {
    return (
      <ErrorState
        message={
          error instanceof Error ? error.message : "An unexpected error occurred."
        }
      />
    );
  }

  if (companies.length === 0) {
    return (
      <EmptyState
        title="No companies are hiring for this role"
        description="No active jobs match that title with the current filters. Try a broader title, or reset the sector and location filters."
        action={
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/search?mode=role">Reset filters</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ResultsGrid count={companies.length}>
      {companies.map((company) => (
        <CompanyCard
          key={company.id}
          company={company}
          matchingJobs={company.matching_jobs}
        />
      ))}
    </ResultsGrid>
  );
}

/** Company-name search — unchanged existing behaviour. */
async function CompanyResults({ filters }: SearchResultsProps) {
  let companies: CompanySummary[];
  try {
    companies = await fetchCompanies(filters);
  } catch (error) {
    return (
      <ErrorState
        message={
          error instanceof Error ? error.message : "An unexpected error occurred."
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
    <ResultsGrid count={companies.length}>
      {companies.map((company) => (
        <CompanyCard key={company.id} company={company} />
      ))}
    </ResultsGrid>
  );
}

/**
 * Async server component that runs the Supabase query for the current filters
 * and renders the result grid, plus empty and error states. Wrapped in a
 * Suspense boundary by the page so a skeleton shows while it loads.
 */
export async function SearchResults({ filters }: SearchResultsProps) {
  return filters.mode === "role" ? (
    <RoleResults filters={filters} />
  ) : (
    <CompanyResults filters={filters} />
  );
}
