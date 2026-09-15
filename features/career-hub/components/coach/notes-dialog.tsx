"use client";

import * as React from "react";
import { Loader2, NotebookPen, TriangleAlert } from "lucide-react";

import { saveNotesAction } from "@/app/coach/(workspace)/companies/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface NotesDialogProps {
  companyId: string;
  companyName: string;
  notes: string;
  onSaved: (notes: string) => void;
}

/** Dialog for viewing and editing a coach's private notes on a company. */
export function NotesDialog({
  companyId,
  companyName,
  notes,
  onSaved,
}: NotesDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(notes);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const hasNotes = notes.trim().length > 0;

  React.useEffect(() => {
    if (open) {
      setDraft(notes);
      setError(null);
    }
  }, [open, notes]);

  function handleSave() {
    startTransition(async () => {
      const result = await saveNotesAction(companyId, draft);
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved(draft);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <NotebookPen className="size-4" />
          {hasNotes ? "Notes" : "Add note"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Private notes</DialogTitle>
          <DialogDescription>
            {companyName} · visible only to you
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={pending}
          placeholder="Add outreach notes, contacts, next steps…"
          className="min-h-40"
        />

        {error && (
          <p
            role="alert"
            className="flex items-center gap-2 text-sm text-destructive"
          >
            <TriangleAlert className="size-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={handleSave}
            disabled={pending}
           
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? "Saving…" : "Save notes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
