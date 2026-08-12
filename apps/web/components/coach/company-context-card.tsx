import * as React from "react";
import Link from "next/link";
import { Briefcase, ExternalLink, MapPin } from "lucide-react";

import type { OutreachCompanyContext } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { LeadScoreBadge } from "@/components/lead-score-badge";

interface CompanyContextCardProps {
  company: OutreachCompanyContext;
}

/** Read-only context panel for a company on the outreach composer page. */
export function CompanyContextCard({ company }: CompanyContextCardProps) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {company.sector && (
                <Badge variant="secondary" className="rounded-full">
                  {company.sector}
                </Badge>
              )}
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              {company.name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4" />
                {company.location}
              </span>
              <span className="flex items-center gap-1.5">
                <Briefcase className="size-4" />
                {company.open_jobs} open{" "}
                {company.open_jobs === 1 ? "job" : "jobs"}
              </span>
            </div>
          </div>
          <LeadScoreBadge score={company.lead_score} />
        </div>

        <Link
          href={`/companies/${company.slug}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
        >
          <ExternalLink className="size-4" />
          View public company profile
        </Link>
      </div>
    </section>
  );
}
