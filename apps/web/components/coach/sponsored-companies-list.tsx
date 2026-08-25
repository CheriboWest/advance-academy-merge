"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Briefcase, MapPin, Search, Users } from "lucide-react";

import type {
  CompanySponsorshipStatusCompact,
  SponsoredCompanyRow,
  SponsorshipStatus,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { SponsorshipBadge } from "@/components/coach/sponsorship-badge";
import { EmptyState } from "@/components/empty-state";

interface SponsoredCompaniesListProps {
  companies: SponsoredCompanyRow[];
  /** Keyed by company_id. A company absent here (a failed batch fetch, or
   *  simply never checked) renders no sponsorship badge — the card is still
   *  fully usable without one. */
  sponsorshipStatuses?: Record<string, CompanySponsorshipStatusCompact>;
  /** Keyed by company_id. A company absent here has 0 contacts. */
  contactCounts?: Record<string, number>;
}

const SPONSORSHIP_FILTER_ALL = "all";

/** Maps a filter option to the exact sponsorship status it selects — the same
 * five values the badge already renders. No new semantics; a company with no
 * status entry at all (batch fetch failed, or never checked) is treated the
 * same as an explicit `not_checked` for filtering purposes, since that is
 * what the badge shows it as too. */
const SPONSORSHIP_FILTER_OPTIONS: ReadonlyArray<{
  value: SponsorshipStatus;
  label: string;
}> = [
  { value: "licensed", label: "Licensed" },
  { value: "ambiguous", label: "Possible match" },
  { value: "no_match", label: "No confirmed" },
  { value: "not_checked", label: "Not checked" },
  { value: "error", label: "Unavailable" },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function matchesSearch(company: SponsoredCompanyRow, query: string): boolean {
  if (!query) return true;
  return (
    normalize(company.name).includes(query) ||
    (company.sector ? normalize(company.sector).includes(query) : false) ||
    normalize(company.location).includes(query)
  );
}

/** Grid of sponsored companies — sponsorship status, contact count, open
 * jobs and location/sector at a glance — with a client-side search box and
 * sponsorship-status filter above it. Each card opens the full company
 * profile (overview, visa sponsorship, open jobs, contacts).
 *
 * Client-side, not a new backend endpoint: `companies` is already the full,
 * unpaginated list for this coach (see getSponsoredCompanies) and both
 * `sponsorshipStatuses` and `contactCounts` are already the full batches
 * fetched once on page load — filtering an array already in memory needs no
 * additional request.
 */
export function SponsoredCompaniesList({
  companies,
  sponsorshipStatuses = {},
  contactCounts = {},
}: SponsoredCompaniesListProps) {
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<
    typeof SPONSORSHIP_FILTER_ALL | SponsorshipStatus
  >(SPONSORSHIP_FILTER_ALL);

  if (companies.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="No sponsored companies yet"
        description="Once companies are available, their sponsorship status and contacts will show up here."
      />
    );
  }

  const normalizedQuery = normalize(query);
  const filtered = companies.filter((company) => {
    if (!matchesSearch(company, normalizedQuery)) return false;
    if (statusFilter === SPONSORSHIP_FILTER_ALL) return true;
    const status = sponsorshipStatuses[company.company_id]?.status ?? "not_checked";
    return status === statusFilter;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search companies..."
            aria-label="Search companies"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(next) =>
            setStatusFilter(next as typeof SPONSORSHIP_FILTER_ALL | SponsorshipStatus)
          }
        >
          <SelectTrigger aria-label="Filter by sponsorship status" className="sm:w-52">
            <SelectValue placeholder="Sponsorship: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SPONSORSHIP_FILTER_ALL}>Sponsorship: All</SelectItem>
            {SPONSORSHIP_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No companies match these filters."
          description="Try a different search term or clear the sponsorship filter."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {filtered.map((company) => {
            const contactCount = contactCounts[company.company_id] ?? 0;
            return (
              <article
                key={company.company_id}
                className="flex h-full flex-col justify-between gap-6 rounded-sm border border-border bg-card p-6 transition-shadow hover:shadow-md"
              >
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-lg leading-tight">{company.name}</h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SponsorshipBadge
                          status={sponsorshipStatuses[company.company_id]}
                        />
                        {company.sector && (
                          <span className="text-sm text-muted-foreground">
                            {company.sector}
                          </span>
                        )}
                      </div>
                    </div>
                    <LeadScoreBadge score={company.lead_score} />
                  </div>

                  <dl className="grid gap-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="size-4 shrink-0" />
                      <span>{company.location}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="size-4 shrink-0" />
                      <span>
                        {contactCount} {contactCount === 1 ? "contact" : "contacts"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Briefcase className="size-4 shrink-0" />
                      <span>
                        {company.open_jobs} open{" "}
                        {company.open_jobs === 1 ? "job" : "jobs"}
                      </span>
                    </div>
                  </dl>
                </div>

                <Button asChild variant="outline" className="w-full">
                  <Link href={`/coach/sponsored-companies/${company.company_id}`}>
                    View company
                    <ArrowUpRight className="size-4" />
                  </Link>
                </Button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
