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
    <div className={cn("border-y border-border py-14", className)}>
      <div className="flex max-w-xl gap-4">
        <Icon className="mt-1 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="text-xl">{title}</h3>
          {description && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
          {action && <div className="mt-5">{action}</div>}
        </div>
      </div>
    </div>
  );
}
