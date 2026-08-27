"use client";

import * as React from "react";
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";

import { refreshCompanySummaryViaApi } from "@/lib/company-summary-api";
import { CompanySummary } from "@/components/company-summary";
import { Button } from "@/components/ui/button";

interface CompanySummaryPanelProps {
  companyId: string;
  /** Server-rendered on page load, from `public_company_summary.ai_summary`. */
  initialSummary: string | null;
}

/**
 * The same stored `ai_summary` the public company page shows (via the shared
 * `CompanySummary` component), plus a coach-only manual refresh — the one
 * write-time trigger a coach can invoke directly, alongside the automatic
 * ones (company creation, post-crawl enrichment). Unlike the post-crawl
 * sweep, the backend does NOT quietly fall back to the template if the AI
 * call fails here — a coach who clicks "Regenerate" should see that it
 * failed, not silently get a worse result.
 */
export function CompanySummaryPanel({
  companyId,
  initialSummary,
}: CompanySummaryPanelProps) {
  const [summary, setSummary] = React.useState(initialSummary);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const result = await refreshCompanySummaryViaApi(companyId);
      setSummary(result.ai_summary);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not regenerate the summary. Try again in a moment."
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <CompanySummary summary={summary} className="mt-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0 text-muted-foreground"
        >
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Regenerate
        </Button>
      </div>
      {!summary && !refreshing && (
        <p className="text-sm text-muted-foreground">
          No summary generated yet.
        </p>
      )}
      {error && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <TriangleAlert className="size-4" />
          {error}
        </p>
      )}
    </div>
  );
}
