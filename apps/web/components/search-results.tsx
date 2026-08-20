import * as React from "react";
import Link from "next/link";
import { Search, TriangleAlert } from "lucide-react";

import { fetchCompanies } from "@/lib/queries";
import { fetchCompaniesByRole } from "@/lib/role-search";
import type { SearchFiltersState } from "@/lib/filters";
import type { CompanyRoleResult, CompanySummary } from "@/lib/types";
import { CompanyRow } from "@/components/company-row";
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
        <Button asChild variant="outline">
          <Link href="/search">Try again</Link>
        </Button>
      }
    />
  );
}

function ResultsList({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p
        className="label-caps border-b-2 border-foreground pb-3"
        aria-live="polite"
      >
        {count} {count === 1 ? "company" : "companies"} found
      </p>
      <ul className="divide-y divide-border">{children}</ul>
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
          <Button asChild variant="outline">
            <Link href="/search?mode=role">Reset filters</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ResultsList count={companies.length}>
      {companies.map((company) => (
        <li key={company.id}>
          <CompanyRow company={company} matchingJobs={company.matching_jobs} />
        </li>
      ))}
    </ResultsList>
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
          <Button asChild variant="outline">
            <Link href="/search">Reset filters</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ResultsList count={companies.length}>
      {companies.map((company) => (
        <li key={company.id}>
          <CompanyRow company={company} />
        </li>
      ))}
    </ResultsList>
  );
}

/**
 * Async server component that runs the Supabase query for the current filters
 * and renders the result list, plus empty and error states. Wrapped in a
 * Suspense boundary by the page so a skeleton shows while it loads.
 */
export async function SearchResults({ filters }: SearchResultsProps) {
  return filters.mode === "role" ? (
    <RoleResults filters={filters} />
  ) : (
    <CompanyResults filters={filters} />
  );
}
