"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Briefcase, MapPin, Search, Users } from "lucide-react";

import type {
  CompanySponsorshipStatusCompact,
  SponsoredCompanyRow,
  SponsorshipStatus,
} from "@/features/career-hub/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeadScoreBadge } from "@/features/career-hub/components/lead-score-badge";
import { SponsorshipBadge } from "@/features/career-hub/components/coach/sponsorship-badge";
import { EmptyState } from "@/features/career-hub/components/empty-state";

interface SponsoredCompaniesListProps {
  companies: SponsoredCompanyRow[];
  /** Keyed by company_id. A company absent here (a failed batch fetch, or
   *  simply never checked) renders no sponsorship badge — the card is still
   *  fully usable without one.
   *
   *  A promise, not a resolved map: the server hands this over unawaited so
   *  the cards paint without waiting on it. See page.tsx. */
  sponsorshipStatuses?: Promise<Record<string, CompanySponsorshipStatusCompact>>;
  /** Keyed by company_id. A company absent here has 0 contacts. Streamed in
   *  the same way as `sponsorshipStatuses`. */
  contactCounts?: Promise<Record<string, number>>;
}

/**
 * A promise prop's value once it lands, or `undefined` while it is still in
 * flight — which is deliberately distinguishable from a resolved empty map
 * ("we asked, there is nothing"), because the two render differently.
 *
 * `useEffect` rather than `React.use()`: `use()` would suspend this whole
 * component until the data arrived, which is exactly the wait we are trying to
 * get rid of, and a suspended re-render would throw away the search box's
 * state on every fill-in.
 */
function useResolved<T>(promise: Promise<T> | undefined): T | undefined {
  const [value, setValue] = React.useState<T>();

  React.useEffect(() => {
    if (!promise) return;
    let alive = true;
    promise.then((next) => {
      if (alive) setValue(next);
    });
    return () => {
      alive = false;
    };
  }, [promise]);

  return value;
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
  sponsorshipStatuses: sponsorshipStatusesPromise,
  contactCounts: contactCountsPromise,
}: SponsoredCompaniesListProps) {
  const sponsorshipStatuses = useResolved(sponsorshipStatusesPromise);
  const contactCounts = useResolved(contactCountsPromise);
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
    // Still streaming: let every company through rather than matching them
    // against a map we do not have yet, which would flash "No companies match
    // these filters" and read as a broken page.
    if (statusFilter === SPONSORSHIP_FILTER_ALL || !sponsorshipStatuses) return true;
    const status = sponsorshipStatuses[company.company_id]?.status ?? "not_checked";
    return status === statusFilter;
  });

  // Counted from the batch already on the page, not a separate request: the
  // same map the badges read. `null` while it is still streaming, which
  // renders as "—" rather than a wrong 0.
  const licensedCount = sponsorshipStatuses
    ? companies.filter(
        (company) =>
          sponsorshipStatuses[company.company_id]?.status === "licensed"
      ).length
    : null;

  const total = companies.length.toLocaleString("en-GB");

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

      <p className="text-sm text-muted-foreground">
        {filtered.length === companies.length
          ? `${total} companies`
          : `Showing ${filtered.length.toLocaleString("en-GB")} of ${total} companies`}
        {" · "}
        {licensedCount === null
          ? "— licensed sponsors"
          : `${licensedCount.toLocaleString("en-GB")} licensed ${
              licensedCount === 1 ? "sponsor" : "sponsors"
            }`}
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No companies match these filters."
          description="Try a different search term or clear the sponsorship filter."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {filtered.map((company) => {
            const contactCount = contactCounts?.[company.company_id] ?? 0;
            return (
              <article
                key={company.company_id}
                className="flex h-full flex-col justify-between gap-6 rounded-lg border border-border bg-card p-6 transition-shadow hover:shadow-md"
              >
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-lg leading-tight">{company.name}</h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {sponsorshipStatuses ? (
                          <SponsorshipBadge
                            status={sponsorshipStatuses[company.company_id]}
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="h-5 w-24 animate-pulse rounded-full bg-muted"
                          />
                        )}
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
                        {contactCounts
                          ? `${contactCount} ${contactCount === 1 ? "contact" : "contacts"}`
                          : "— contacts"}
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
