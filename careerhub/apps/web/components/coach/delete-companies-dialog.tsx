"use client";

import * as React from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import {
  deleteCompaniesPermanentlyAction,
  type DeleteCompaniesResult,
} from "@/app/coach/(workspace)/companies/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** The minimum a row needs to be named in the confirmation. */
export interface DeletableCompany {
  company_id: string;
  name: string;
}

interface DeleteCompaniesDialogProps {
  /** Companies to delete — one row's, or every selected row's. */
  companies: DeletableCompany[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a deletion that removed at least one company. */
  onDeleted: (result: DeleteCompaniesResult) => void;
}

/** How many company names to spell out before summarising the rest. */
const NAMES_SHOWN = 8;

/**
 * Confirmation for permanent, global company deletion — used by both the
 * row-level trash button and the bulk "Delete selected" action, so the wording
 * and the server call are identical either way.
 *
 * Nothing is deleted until the destructive button is pressed, and the deletion
 * itself runs in a server action; this component never touches the database.
 */
export function DeleteCompaniesDialog({
  companies,
  open,
  onOpenChange,
  onDeleted,
}: DeleteCompaniesDialogProps) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const count = companies.length;
  const plural = count === 1 ? "company" : "companies";

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCompaniesPermanentlyAction(
        companies.map((company) => company.company_id)
      );

      if (result.error) {
        setError(result.error);
        return;
      }

      // A partial result is surfaced rather than glossed over: the dialog stays
      // open so the coach sees which ids did not delete, while the rows that
      // did are removed from the table.
      if (result.missing.length > 0) {
        onDeleted(result);
        setError(
          `Deleted ${result.deleted} of ${result.requested}. ` +
            `${result.missing.length} ${
              result.missing.length === 1 ? "company was" : "companies were"
            } already gone.`
        );
        return;
      }

      onDeleted(result);
      onOpenChange(false);
    });
  }

  const shown = companies.slice(0, NAMES_SHOWN);
  const overflow = count - shown.length;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="size-5 shrink-0" />
            Permanently delete {count} {plural}?
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3">
              <p className="font-medium text-foreground">
                This deletes the {plural} from the database for{" "}
                <strong>everyone</strong>: you, every other coach, every
                student, the public company search, and{" "}
                {count === 1 ? "its detail page" : "their detail pages"}. It
                cannot be undone.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  All jobs belonging to{" "}
                  {count === 1 ? "this company" : "these companies"} are deleted.
                </li>
                <li>
                  Stars, notes, and removed/hidden state are deleted for every
                  coach, not only you.
                </li>
                <li>
                  Outreach emails are <strong>kept</strong>, but no longer linked
                  to {count === 1 ? "the company" : "the companies"}.
                </li>
              </ul>
              <p>
                To take {count === 1 ? "a company" : "companies"} off your own
                list without affecting anyone else, use{" "}
                <strong>Remove from my list</strong> instead.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-40 overflow-y-auto rounded-sm border border-border bg-muted/40 p-3 text-sm">
          <ul className="space-y-1">
            {shown.map((company) => (
              <li key={company.company_id} className="truncate font-medium">
                {company.name}
              </li>
            ))}
          </ul>
          {overflow > 0 && (
            <p className="mt-1 text-muted-foreground">
              …and {overflow} more {overflow === 1 ? "company" : "companies"}.
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 text-sm text-destructive"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={handleDelete}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending
              ? "Deleting…"
              : `Permanently delete ${count} ${plural}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
