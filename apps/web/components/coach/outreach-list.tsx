import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Briefcase, MapPin, PenLine } from "lucide-react";

import type { CompanySponsorshipStatusCompact, OutreachCompany } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { SponsorshipBadge } from "@/components/coach/sponsorship-badge";
import { EmptyState } from "@/components/empty-state";

interface OutreachListProps {
  companies: OutreachCompany[];
  /** Keyed by company_id. A company absent here (a failed batch fetch, or
   *  simply never checked) renders no sponsorship badge — the card is still
   *  fully usable without one. */
  sponsorshipStatuses?: Record<string, CompanySponsorshipStatusCompact>;
}

/** Grid of companies with an entry point into the outreach composer. */
export function OutreachList({
  companies,
  sponsorshipStatuses = {},
}: OutreachListProps) {
  if (companies.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="No companies to reach out to yet"
        description="Once companies are available, you'll be able to draft outreach here."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {companies.map((company) => (
        <article
          key={company.company_id}
          className="flex h-full flex-col justify-between gap-6 rounded-sm border border-border bg-card p-6 transition-shadow hover:shadow-md"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-lg leading-tight">
                  {company.name}
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  {company.hasDraft && (
                    <Badge variant="secondary">
                      Draft saved
                    </Badge>
                  )}
                  <SponsorshipBadge
                    status={sponsorshipStatuses[company.company_id]}
                  />
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
                <Briefcase className="size-4 shrink-0" />
                <span>
                  {company.open_jobs} open{" "}
                  {company.open_jobs === 1 ? "job" : "jobs"}
                </span>
              </div>
            </dl>
          </div>

          <Button asChild className="w-full">
            <Link href={`/coach/outreach/${company.company_id}`}>
              {company.hasDraft ? (
                <>
                  <PenLine className="size-4" />
                  Edit outreach
                </>
              ) : (
                <>
                  Create outreach
                  <ArrowUpRight className="size-4" />
                </>
              )}
            </Link>
          </Button>
        </article>
      ))}
    </div>
  );
}
