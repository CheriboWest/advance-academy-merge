"use client";

import * as React from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import type { OutreachActivityRow } from "@/features/career-hub/lib/types";
import {
  saveOutreachNotesAction,
  setFollowUpAction,
} from "@/app/coach/(workspace)/outreach/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface OutreachManageDialogProps {
  activity: OutreachActivityRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (patch: { followUpAt: string | null; notes: string | null }) => void;
}

/** Follow-up date and notes to a `YYYY-MM-DD` for a native date input. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * Set/change the follow-up date and edit notes for one outreach activity.
 * Two fields, one dialog, one Save — separate dialogs for each would be more
 * clicks for two things a coach naturally updates together after a call or
 * a check of the inbox.
 */
export function OutreachManageDialog({
  activity,
  open,
  onOpenChange,
  onSaved,
}: OutreachManageDialogProps) {
  const [followUpDate, setFollowUpDate] = React.useState(
    toDateInputValue(activity.followUpAt)
  );
  const [notes, setNotes] = React.useState(activity.notes ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setFollowUpDate(toDateInputValue(activity.followUpAt));
      setNotes(activity.notes ?? "");
      setError(null);
    }
  }, [open, activity.followUpAt, activity.notes]);

  function handleSave() {
    setError(null);
    setSaving(true);
    void (async () => {
      try {
        // A date-only input has no time zone of its own — store it as
        // midnight UTC on that date, so "due" comparisons (see
        // lib/outreach-activity.ts) trigger from the start of that day
        // everywhere, not whichever moment the coach happened to save it.
        const followUpAt = followUpDate ? `${followUpDate}T00:00:00.000Z` : null;

        const [followUpResult, notesResult] = await Promise.all([
          followUpAt !== activity.followUpAt
            ? setFollowUpAction(activity.id, followUpAt)
            : Promise.resolve({ ok: true, error: null }),
          notes !== (activity.notes ?? "")
            ? saveOutreachNotesAction(activity.id, notes)
            : Promise.resolve({ ok: true, error: null }),
        ]);

        if (!followUpResult.ok) {
          setError(followUpResult.error ?? "Could not save the follow-up date.");
          return;
        }
        if (!notesResult.ok) {
          setError(notesResult.error ?? "Could not save notes.");
          return;
        }

        onSaved({ followUpAt, notes: notes.trim() || null });
        onOpenChange(false);
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage outreach</DialogTitle>
          <DialogDescription>
            {activity.contactName ?? activity.recipientEmail ?? "This contact"} at{" "}
            {activity.companyName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="follow-up-date" className="text-sm font-medium">
              Follow up by
            </label>
            <Input
              id="follow-up-date"
              type="date"
              value={followUpDate}
              onChange={(event) => setFollowUpDate(event.target.value)}
              disabled={saving}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="outreach-notes" className="text-sm font-medium">
              Notes
            </label>
            <Textarea
              id="outreach-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="How it went, what to say next time…"
              disabled={saving}
              className="min-h-32"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <TriangleAlert className="size-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
