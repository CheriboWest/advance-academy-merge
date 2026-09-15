import Link from "next/link";
import { ArrowUpRight, NotebookPen } from "lucide-react";

import type { CompanySponsorshipStatus } from "@/features/career-hub/lib/types";
import { SponsorshipBadge } from "@/features/career-hub/components/coach/sponsorship-badge";

interface OutreachResearchSummaryProps {
  companyId: string;
  sponsorshipStatus: CompanySponsorshipStatus | null;
  companyNotes: string | null;
}

/**
 * Compact sponsorship + notes research context for the Outreach composer —
 * deliberately not the full interactive SponsorshipCard (recheck button,
 * full candidate detail): that's company *management*, which stays on the
 * Sponsored Company profile (linked below). This is company *research* for
 * writing one email, reusing the same SponsorshipBadge and
 * CompanySponsorshipStatus/SponsorshipMatch data, not a second sponsorship
 * check or a separate copy of the status.
 */
export function OutreachResearchSummary({
  companyId,
  sponsorshipStatus,
  companyNotes,
}: OutreachResearchSummaryProps) {
  const match = sponsorshipStatus?.match;

  return (
    <section className="space-y-3 rounded-sm border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg">Visa sponsorship</h3>
        <SponsorshipBadge
          status={
            sponsorshipStatus
              ? {
                  status: sponsorshipStatus.status,
                  stale: sponsorshipStatus.stale,
                  checked_at: sponsorshipStatus.checked_at,
                }
              : undefined
          }
        />
      </div>

      {match && (
        <p className="text-sm text-muted-foreground">
          Registered as <span className="text-foreground">{match.organisation_name}</span>
          {match.routes.length > 0 && <> · {match.routes.join(", ")}</>}
        </p>
      )}

      <Link
        href={`/coach/sponsored-companies/${companyId}`}
        className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
      >
        View full sponsorship details
        <ArrowUpRight className="size-3.5" />
      </Link>

      {companyNotes && (
        <div className="flex items-start gap-2 border-t border-border pt-3 text-sm">
          <NotebookPen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">{companyNotes}</p>
        </div>
      )}
    </section>
  );
}
