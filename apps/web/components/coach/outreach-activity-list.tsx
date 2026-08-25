"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  Mail,
  NotebookPen,
  TimerReset,
  XCircle,
} from "lucide-react";

import type { OutreachActivityRow, OutreachDisplayStatus } from "@/lib/types";
import { markRepliedAction, closeOutreachAction } from "@/app/coach/(workspace)/outreach/actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import {
  OUTREACH_STATUS_FILTERS,
  OutreachStatusBadge,
} from "@/components/coach/outreach-status-badge";
import { OutreachManageDialog } from "@/components/coach/outreach-manage-dialog";

const FILTER_ALL = "all";

interface OutreachActivityListProps {
  activities: OutreachActivityRow[];
  /** Hides the company name/link on each row — for the Sponsored Company
   *  page's "Outreach history", where every row is already this company. */
  hideCompany?: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Filterable list of sent outreach: contact, company, status, last
 * contacted, follow-up date, and per-row actions (mark replied, close,
 * manage follow-up/notes). Client-side filtering over data already fetched
 * once (lib/outreach-activity.ts) — same pattern as SponsoredCompaniesList's
 * search/status filter, no extra request per filter change.
 */
export function OutreachActivityList({
  activities: initialActivities,
  hideCompany = false,
}: OutreachActivityListProps) {
  const [activities, setActivities] = React.useState(initialActivities);
  const [filter, setFilter] = React.useState<typeof FILTER_ALL | OutreachDisplayStatus>(
    FILTER_ALL
  );
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [managing, setManaging] = React.useState<OutreachActivityRow | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setActivities(initialActivities), [initialActivities]);

  const filtered = activities.filter(
    (activity) => filter === FILTER_ALL || activity.displayStatus === filter
  );

  function patchActivity(id: string, patch: Partial<OutreachActivityRow>) {
    setActivities((prev) =>
      prev.map((activity) => (activity.id === id ? { ...activity, ...patch } : activity))
    );
  }

  function handleMarkReplied(activity: OutreachActivityRow) {
    setError(null);
    setPendingId(activity.id);
    void (async () => {
      const result = await markRepliedAction(activity.id);
      if (result.ok) {
        patchActivity(activity.id, { storedStatus: "replied", displayStatus: "replied" });
      } else {
        setError(result.error ?? "Could not mark this as replied.");
      }
      setPendingId(null);
    })();
  }

  function handleClose(activity: OutreachActivityRow) {
    setError(null);
    setPendingId(activity.id);
    void (async () => {
      const result = await closeOutreachAction(activity.id);
      if (result.ok) {
        patchActivity(activity.id, { storedStatus: "closed", displayStatus: "closed" });
      } else {
        setError(result.error ?? "Could not close this outreach.");
      }
      setPendingId(null);
    })();
  }

  if (activities.length === 0) {
    return (
      <EmptyState
        icon={Mail}
        title="No outreach sent yet"
        description="Once you send an outreach email, it'll show up here so you can track replies and follow-ups."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Select
        value={filter}
        onValueChange={(next) => setFilter(next as typeof FILTER_ALL | OutreachDisplayStatus)}
      >
        <SelectTrigger aria-label="Filter by status" className="sm:w-56">
          <SelectValue placeholder="Status: All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FILTER_ALL}>Status: All</SelectItem>
          {OUTREACH_STATUS_FILTERS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No outreach matches this filter."
          description="Try a different status."
        />
      ) : (
        <ul className="space-y-3">
          {filtered.map((activity) => {
            const busy = pendingId === activity.id;
            const canMarkReplied =
              activity.storedStatus !== "replied" && activity.storedStatus !== "closed";
            const canClose = activity.storedStatus !== "closed";

            return (
              <li
                key={activity.id}
                className="flex flex-col gap-3 rounded-sm border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {activity.contactName ?? activity.recipientEmail ?? "Unknown recipient"}
                    </span>
                    {activity.contactRole && (
                      <span className="text-sm text-muted-foreground">
                        · {activity.contactRole}
                      </span>
                    )}
                    <OutreachStatusBadge status={activity.displayStatus} />
                  </div>

                  {!hideCompany && (
                    <Link
                      href={`/coach/sponsored-companies/${activity.companyId}`}
                      className="block text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {activity.companyName}
                    </Link>
                  )}

                  {activity.subject && (
                    <p className="text-sm text-muted-foreground">{activity.subject}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarClock className="size-3.5" />
                      Last contacted {formatDate(activity.lastContactedAt)}
                    </span>
                    {activity.followUpAt && (
                      <span className="flex items-center gap-1">
                        <TimerReset className="size-3.5" />
                        Follow up by {formatDate(activity.followUpAt)}
                      </span>
                    )}
                  </div>

                  {activity.notes && (
                    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                      <NotebookPen className="mt-0.5 size-3.5 shrink-0" />
                      {activity.notes}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {canMarkReplied && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleMarkReplied(activity)}
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      Mark replied
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setManaging(activity)}
                  >
                    <TimerReset className="size-4" />
                    Manage
                  </Button>
                  {canClose && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleClose(activity)}
                    >
                      <XCircle className="size-4" />
                      Close
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {managing && (
        <OutreachManageDialog
          activity={managing}
          open={Boolean(managing)}
          onOpenChange={(next) => !next && setManaging(null)}
          onSaved={(patch) => {
            patchActivity(managing.id, {
              followUpAt: patch.followUpAt,
              notes: patch.notes,
              displayStatus:
                managing.storedStatus === "sent" &&
                patch.followUpAt &&
                new Date(patch.followUpAt) <= new Date()
                  ? "follow_up_due"
                  : managing.storedStatus,
            });
          }}
        />
      )}
    </div>
  );
}
