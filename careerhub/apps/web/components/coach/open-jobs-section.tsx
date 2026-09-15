import { Briefcase } from "lucide-react";

import type { Job } from "@/lib/types";
import { JobItem } from "@/components/job-item";
import { EmptyState } from "@/components/empty-state";

interface OpenJobsSectionProps {
  jobs: Job[];
}

/**
 * A company's open jobs — shared between the Sponsored Company detail page
 * and the Outreach research panel so both read the exact same live listing
 * (via fetchActiveJobs) rather than each rendering its own copy.
 */
export function OpenJobsSection({ jobs }: OpenJobsSectionProps) {
  return (
    <section className="space-y-4 rounded-sm border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg">Open jobs</h3>
        <span className="label-caps tabular-nums text-muted-foreground">
          {jobs.length} live
        </span>
      </div>
      {jobs.length > 0 ? (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <JobItem job={job} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Briefcase}
          title="No open jobs right now"
          description="This company doesn't have any live roles at the moment."
        />
      )}
    </section>
  );
}
