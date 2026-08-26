"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";

import type { SponsoredCompanyRow } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

interface OutreachShellProps {
  companies: SponsoredCompanyRow[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Step 1 of the Outreach flow: choose a company. Picking one navigates to
 * /coach/outreach/[companyId], where steps 2-6 (contact, research,
 * generation, editing, sending) happen — see that page and
 * OutreachComposer. Reuses the same company set as Sponsored Companies
 * (getSponsoredCompanies, passed in from the server) rather than a second copy.
 */
export function OutreachShell({ companies }: OutreachShellProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  const normalizedQuery = normalize(query);
  const filtered = companies.filter((company) => {
    if (!normalizedQuery) return true;
    return (
      normalize(company.name).includes(normalizedQuery) ||
      (company.sector ? normalize(company.sector).includes(normalizedQuery) : false) ||
      normalize(company.location).includes(normalizedQuery)
    );
  });

  return (
    <section className="space-y-4 rounded-sm border border-border bg-card p-6">
      <label htmlFor="outreach-company-search" className="text-sm font-medium">
        Choose a company
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="outreach-company-search"
          type="search"
          placeholder="Search companies..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No companies match your search."
          description="Try a different search term."
        />
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-sm border border-border">
          {filtered.map((company) => (
            <li key={company.company_id}>
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-between rounded-none px-4 py-3 text-left font-normal"
                onClick={() => router.push(`/coach/outreach/${company.company_id}`)}
              >
                <span>
                  <span className="block">{company.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {company.location}
                    {company.sector ? ` · ${company.sector}` : ""}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
