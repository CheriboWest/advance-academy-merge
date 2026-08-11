import * as React from "react";
import { ArrowUpRight, Banknote, CalendarDays, MapPin } from "lucide-react";

import type { Job } from "@/lib/types";
import { Button } from "@/components/ui/button";

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

export function JobItem({ job }: JobItemProps) {
  const location = job.location_raw ?? job.city ?? "—";
  const salary = formatSalary(job.salary_min, job.salary_max);
  const href = job.apply_url ?? job.url ?? null;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-2">
        <h3 className="font-semibold tracking-tight">{job.title}</h3>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4" />
            {location}
          </span>
          {salary && (
            <span className="flex items-center gap-1.5">
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

      {href && (
        <Button
          asChild
          variant="outline"
          className="w-full shrink-0 rounded-xl sm:w-auto"
        >
          <a href={href} target="_blank" rel="noopener noreferrer">
            View job
            <ArrowUpRight className="size-4" />
          </a>
        </Button>
      )}
    </div>
  );
}
