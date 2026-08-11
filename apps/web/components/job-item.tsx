import * as React from "react";
import { ArrowUpRight, Banknote, CalendarDays, MapPin } from "lucide-react";

import type { Job } from "@/lib/mock-data";
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

export function JobItem({ job }: JobItemProps) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-2">
        <h3 className="font-semibold tracking-tight">{job.title}</h3>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4" />
            {job.location}
          </span>
          {job.salary && (
            <span className="flex items-center gap-1.5">
              <Banknote className="size-4" />
              {job.salary}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-4" />
            Posted {formatPostedDate(job.postedDate)}
          </span>
        </div>
      </div>

      <Button
        asChild
        variant="outline"
        className="w-full shrink-0 rounded-xl sm:w-auto"
      >
        <a href={job.url} target="_blank" rel="noopener noreferrer">
          View job
          <ArrowUpRight className="size-4" />
        </a>
      </Button>
    </div>
  );
}
