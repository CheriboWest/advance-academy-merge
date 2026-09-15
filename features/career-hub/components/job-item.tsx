import * as React from "react";
import { ArrowUpRight, Banknote, CalendarDays, MapPin } from "lucide-react";

import type { Job } from "@/features/career-hub/lib/types";

interface JobItemProps {
  job: Job;
}

/** Format an ISO date as a UK-style `11 Aug 2026` label. */
function formatPostedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Format a GBP amount without decimals, e.g. `£38,000`. */
function formatGbp(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Build a salary label from an optional min/max pair. */
function formatSalary(
  min: number | null,
  max: number | null
): string | null {
  if (min != null && max != null) return `${formatGbp(min)} – ${formatGbp(max)}`;
  if (min != null) return `${formatGbp(min)}+`;
  if (max != null) return `Up to ${formatGbp(max)}`;
  return null;
}

function JobBody({ job }: JobItemProps) {
  const location = job.location_raw ?? job.city ?? "—";
  const salary = formatSalary(job.salary_min, job.salary_max);

  return (
    <>
      <div className="min-w-0 space-y-1.5">
        <h3 className="text-lg">{job.title}</h3>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4" />
            {location}
          </span>
          {salary && (
            <span className="flex items-center gap-1.5 tabular-nums">
              <Banknote className="size-4" />
              {salary}
            </span>
          )}
          {job.posted_at && (
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-4" />
              Posted {formatPostedDate(job.posted_at)}
            </span>
          )}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-highlight-ink">
        View job
        <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </span>
    </>
  );
}

export function JobItem({ job }: JobItemProps) {
  const href = job.source_url ?? null;

  // Without a source URL there is nothing to open — render the same row, but
  // not as a link.
  if (!href) {
    return (
      <div className="card-surface flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <JobBody job={job} />
      </div>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="card-interactive group flex flex-col gap-3 p-5 focus-visible:border-primary/30 focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      <JobBody job={job} />
    </a>
  );
}
