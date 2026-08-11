import * as React from "react";
import { Flame, Minus, Snowflake, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

interface LeadScoreBadgeProps {
  score: number;
  className?: string;
}

type Tier = {
  label: string;
  icon: typeof Flame;
  className: string;
};

/** Map a 0–100 lead score onto a labelled tier with matching colour treatment. */
function tierForScore(score: number): Tier {
  if (score >= 75) {
    return {
      label: "Hot lead",
      icon: Flame,
      className:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300",
    };
  }
  if (score >= 40) {
    return {
      label: "Warm lead",
      icon: TrendingUp,
      className:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300",
    };
  }
  if (score > 0) {
    return {
      label: "Cold lead",
      icon: Snowflake,
      className:
        "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/50 dark:text-sky-300",
    };
  }
  return {
    label: "No score",
    icon: Minus,
    className:
      "border-border bg-muted text-muted-foreground",
  };
}

/** Colour-coded lead score pill used across company cards and detail pages. */
export function LeadScoreBadge({ score, className }: LeadScoreBadgeProps) {
  const { label, icon: Icon, className: tierClass } = tierForScore(score);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        tierClass,
        className
      )}
      title={`Lead score: ${score}/100`}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
      <span className="tabular-nums opacity-70">{score}</span>
    </span>
  );
}
