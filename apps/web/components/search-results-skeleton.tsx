import * as React from "react";

/** Placeholder list shown while search results are loading on the server. */
export function SearchResultsSkeleton() {
  return (
    <div>
      <div className="border-b-2 border-foreground pb-3">
        <div className="h-3 w-32 animate-pulse rounded-sm bg-muted" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-8 py-5 pl-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-6 w-1/3 animate-pulse rounded-sm bg-muted" />
              <div className="h-4 w-1/4 animate-pulse rounded-sm bg-muted" />
            </div>
            <div className="hidden h-10 w-14 animate-pulse rounded-sm bg-muted sm:block" />
            <div className="h-10 w-10 animate-pulse rounded-sm bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
