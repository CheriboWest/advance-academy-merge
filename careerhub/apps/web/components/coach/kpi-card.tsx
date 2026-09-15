import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface KPICardProps {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  hint?: string;
  className?: string;
}

/** One metric in the dashboard's statistics band. */
export function KPICard({
  label,
  value,
  icon: Icon,
  hint,
  className,
}: KPICardProps) {
  return (
    <div className={cn("card-surface p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="label-caps">{label}</p>
        <span className="icon-tile size-9">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 font-display text-4xl leading-none tabular-nums text-foreground">
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
