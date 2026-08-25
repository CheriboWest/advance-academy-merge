import * as React from "react";
import { BadgeCheck, CircleHelp, CircleSlash, Clock, TriangleAlert } from "lucide-react";

import type { CompanySponsorshipStatusCompact } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface SponsorshipBadgeProps {
  /** `undefined` while unresolved (should not happen server-side; kept for a
   *  defensive default) or absent from a batch response — renders nothing
   *  rather than a misleading "not checked". */
  status: CompanySponsorshipStatusCompact | undefined;
  className?: string;
}

const CONFIG: Record<
  CompanySponsorshipStatusCompact["status"],
  { label: string; icon: React.ComponentType<{ className?: string }>; tooltip: string }
> = {
  licensed: {
    label: "Licensed",
    icon: BadgeCheck,
    tooltip: "Matched to the current UK sponsor register",
  },
  ambiguous: {
    label: "Possible",
    icon: CircleHelp,
    tooltip: "Possible sponsor-register match — review details",
  },
  no_match: {
    label: "No confirmed",
    icon: CircleSlash,
    tooltip: "No confirmed sponsor licence found",
  },
  not_checked: {
    label: "Not checked",
    icon: Clock,
    tooltip: "Sponsorship has not been checked yet",
  },
  error: {
    label: "Unavailable",
    icon: TriangleAlert,
    tooltip: "The sponsorship check is temporarily unavailable",
  },
};

/**
 * Compact sponsorship indicator for a company list/card — the same status
 * `SponsorshipCard` shows in full on the company's Sponsored Company page, scaled down
 * to a single small badge. Deliberately quiet: an icon and a couple of words,
 * not a colorful pill, so it never competes with the company name for
 * attention.
 */
export function SponsorshipBadge({ status, className }: SponsorshipBadgeProps) {
  if (!status) return null;

  const config = CONFIG[status.status];
  if (!config) return null;

  const Icon = config.icon;
  const label = status.stale ? "Not checked" : config.label;
  const tooltip = status.stale
    ? "Sponsorship has not been checked against the current register update"
    : config.tooltip;

  return (
    <Badge
      variant={status.status === "licensed" && !status.stale ? "secondary" : "outline"}
      className={cn(className)}
      title={tooltip}
    >
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}
