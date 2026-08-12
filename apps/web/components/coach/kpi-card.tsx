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

/** Compact metric card used across the coach dashboard. */
export function KPICard({
  label,
  value,
  icon: Icon,
  hint,
  className,
}: KPICardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-3xl border border-border bg-card p-6 shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
      </div>
      <p className="text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
