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

/**
 * One metric in the dashboard's statistics band. Cells are separated by rules
 * from the containing grid rather than each being its own floating card.
 */
export function KPICard({
  label,
  value,
  icon: Icon,
  hint,
  className,
}: KPICardProps) {
  return (
    <div className={cn("px-0 py-5 sm:px-6 sm:first:pl-0", className)}>
      <p className="label-caps flex items-center gap-2">
        <Icon className="size-3.5" />
        {label}
      </p>
      <p className="mt-2 font-display text-4xl leading-none tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
