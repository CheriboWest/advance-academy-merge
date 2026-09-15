import type { Metadata } from "next";
import Link from "next/link";
import { Plus, TriangleAlert } from "lucide-react";

import { getOutreachActivities } from "@/features/career-hub/lib/outreach-activity";
import type { OutreachActivityRow } from "@/features/career-hub/lib/types";
import { Button } from "@/components/ui/button";
import { OutreachActivityList } from "@/features/career-hub/components/coach/outreach-activity-list";
import { EmptyState } from "@/features/career-hub/components/empty-state";

export const metadata: Metadata = {
  title: "Outreach",
};

/**
 * Outreach activity dashboard: every outreach the coach has sent, with
 * status/last-contacted/follow-up and the reply/follow-up/close/notes
 * actions. Starting a new outreach (choose company → contact → research →
 * generate → edit → send) lives at /coach/outreach/new, one level down —
 * this page is about what happens *after* a send, per the "after an email
 * is sent, coaches can see what happened" goal.
 */
export default async function OutreachPage() {
  let activities: OutreachActivityRow[];

  try {
    activities = await getOutreachActivities();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return (
      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Track replies and follow-ups for outreach you have sent.
          </p>
          <Button asChild size="sm">
            <Link href="/coach/outreach/new">
              <Plus className="size-4" />
              New outreach
            </Link>
          </Button>
        </header>
        <EmptyState
          icon={TriangleAlert}
          title="We couldn't load your outreach activity"
          description={message}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Track replies and follow-ups for outreach you have sent.
        </p>
        <Button asChild size="sm">
          <Link href="/coach/outreach/new">
            <Plus className="size-4" />
            New outreach
          </Link>
        </Button>
      </header>
      <OutreachActivityList activities={activities} />
    </div>
  );
}
