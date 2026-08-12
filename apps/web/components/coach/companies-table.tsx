"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Star } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CoachCompanyRow } from "@/lib/types";
import { toggleStarAction } from "@/app/coach/(workspace)/companies/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { EmptyState } from "@/components/empty-state";
import { NotesDialog } from "@/components/coach/notes-dialog";

interface CompaniesTableProps {
  rows: CoachCompanyRow[];
}

/** Searchable table of companies with per-coach starring and private notes. */
export function CompaniesTable({ rows }: CompaniesTableProps) {
  const [data, setData] = React.useState(rows);
  const [query, setQuery] = React.useState("");
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  // Keep local state in sync if the server sends fresh data.
  React.useEffect(() => setData(rows), [rows]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.location.toLowerCase().includes(q)
    );
  }, [data, query]);

  function patchRow(companyId: string, patch: Partial<CoachCompanyRow>) {
    setData((prev) =>
      prev.map((row) =>
        row.company_id === companyId ? { ...row, ...patch } : row
      )
    );
  }

  function toggleStar(row: CoachCompanyRow) {
    const next = !row.starred;
    patchRow(row.company_id, { starred: next }); // optimistic
    setPendingId(row.company_id);
    startTransition(async () => {
      const result = await toggleStarAction(row.company_id, next);
      if (result.error) {
        patchRow(row.company_id, { starred: !next }); // revert
      }
      setPendingId(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by company or location"
          aria-label="Search companies"
          className="h-11 rounded-xl pl-9"
        />
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? "company" : "companies"}
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          title="No companies match your search"
          description="Try a different company name or location."
        />
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 text-right font-medium">Open jobs</th>
                <th className="px-4 py-3 font-medium">Lead score</th>
                <th className="px-4 py-3 text-center font-medium">Starred</th>
                <th className="px-4 py-3 text-right font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.company_id}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/companies/${row.slug}`}
                      className="font-medium underline-offset-4 hover:text-primary hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.location}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.open_jobs}
                  </td>
                  <td className="px-4 py-3">
                    <LeadScoreBadge score={row.lead_score} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-lg"
                      aria-pressed={row.starred}
                      aria-label={row.starred ? "Unstar company" : "Star company"}
                      disabled={pendingId === row.company_id}
                      onClick={() => toggleStar(row)}
                    >
                      <Star
                        className={cn(
                          "size-4",
                          row.starred
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground"
                        )}
                      />
                    </Button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <NotesDialog
                      companyId={row.company_id}
                      companyName={row.name}
                      notes={row.notes}
                      onSaved={(notes) => patchRow(row.company_id, { notes })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
