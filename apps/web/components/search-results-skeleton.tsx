import * as React from "react";

/** Placeholder grid shown while search results are loading on the server. */
export function SearchResultsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="flex h-56 flex-col justify-between gap-6 rounded-3xl border border-border bg-card p-6 shadow-sm"
          >
            <div className="space-y-3">
              <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
              <div className="space-y-2 pt-2">
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              </div>
            </div>
            <div className="h-10 w-full animate-pulse rounded-xl bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
