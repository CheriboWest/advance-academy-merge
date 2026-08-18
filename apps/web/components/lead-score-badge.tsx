import * as React from "react";

import { cn } from "@/lib/utils";

interface LeadScoreBadgeProps {
  score: number;
  className?: string;
}

/**
 * Numeric score pill used across company cards and detail pages.
 *
 * Deliberately shows ONLY the numerical score — no tier label, reasoning, or
 * signal breakdown. The value is produced by the backend hiring-signal score
 * and exposed as `company.lead_score`.
 */
export function LeadScoreBadge({ score, className }: LeadScoreBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground tabular-nums",
        className
      )}
    >
      {score}
    </span>
  );
}
