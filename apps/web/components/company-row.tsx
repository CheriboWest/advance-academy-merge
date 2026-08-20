import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { CompanySummary } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { LeadScoreBadge } from "@/components/lead-score-badge";

interface CompanyRowProps {
  company: CompanySummary;
  /**
   * When set (Job Role Search), the number of this company's active jobs that
   * matched the searched role. Rendered alongside — never in place of — the
   * total open-jobs count.
   */
  matchingJobs?: number;
}

/** One company as an editorial listing row. The whole row is the link. */
export function CompanyRow({ company, matchingJobs }: CompanyRowProps) {
  const location = company.hq_location ?? company.region ?? "—";
  const openJobs = company.open_jobs ?? 0;

  return (
    <Link
      href={`/companies/${company.slug}`}
      className="group flex items-center gap-4 border-l-2 border-transparent py-5 pl-3 transition-[background-color,border-color,padding] hover:border-l-primary hover:bg-muted hover:pl-5 focus-visible:border-l-primary focus-visible:bg-muted focus-visible:outline-none sm:gap-8"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="truncate text-xl sm:text-2xl">{company.name}</h3>
          {matchingJobs !== undefined && (
            <Badge variant="highlight">
              {matchingJobs} matching
            </Badge>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {company.sector ? `${company.sector} · ` : ""}
          {location}
        </p>
      </div>

      <div className="hidden shrink-0 text-right leading-none sm:block">
        <span className="label-caps">Open roles</span>
        <span className="mt-1 block font-display text-2xl tabular-nums">
          {openJobs}
        </span>
      </div>

      <LeadScoreBadge score={company.lead_score ?? 0} className="shrink-0" />

      <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
    </Link>
  );
}
