import * as React from "react";
import { SearchX, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}

/** Placeholder shown when a list or search returns no results. */
export function EmptyState({
  title,
  description,
  icon: Icon = SearchX,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("card-surface px-6 py-12 text-center", className)}>
      <span className="icon-tile mx-auto">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-4 text-xl">{title}</h3>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
