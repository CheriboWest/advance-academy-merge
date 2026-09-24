"use client";

import * as React from "react";
import {
  Linkedin,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Trash2,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import type { Contact } from "@/features/career-hub/lib/types";
import { deleteContactViaApi } from "@/features/career-hub/lib/contacts-api";
import { revalidateContactPaths } from "@/app/coach/(workspace)/sponsored-companies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContactFormDialog } from "@/features/career-hub/components/coach/contact-form-dialog";

interface ContactsSectionProps {
  companyId: string;
  /** The company's contacts as of the server render. Own local state from
   *  here — self-contained, since nothing else on the Sponsored Company page
   *  needs to react live to an add/edit/delete (unlike the old outreach
   *  composer's recipient picker, which is why this used to be a
   *  parent-controlled component). A mutation still triggers
   *  `revalidateContactPaths` so the Sponsored Companies list's contact
   *  count — and a future reload of this page — don't serve stale data from
   *  the Router Cache; that's cache invalidation, not this component's own
   *  render, which is why it doesn't touch this local state. */
  initialContacts: Contact[];
}

/**
 * View, add, edit and delete contacts for one company. Never rendered on a
 * public/student-facing page — this page is coach-only
 * (`get_current_user`-gated all the way down through /contacts).
 */
export function ContactsSection({
  companyId,
  initialContacts,
}: ContactsSectionProps) {
  const [contacts, setContacts] = React.useState(initialContacts);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Contact | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<Contact | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  function openAddForm() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEditForm(contact: Contact) {
    setEditing(contact);
    setFormOpen(true);
  }

  function handleSaved(saved: Contact) {
    setContacts((prev) => {
      const exists = prev.some((c) => c.id === saved.id);
      return exists
        ? prev.map((c) => (c.id === saved.id ? saved : c))
        : [saved, ...prev];
    });
    void revalidateContactPaths(companyId);
  }

  function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    void (async () => {
      try {
        await deleteContactViaApi(pendingDelete.id);
        setContacts((prev) => prev.filter((c) => c.id !== pendingDelete.id));
        setPendingDelete(null);
        void revalidateContactPaths(companyId);
      } catch (err) {
        setDeleteError(
          err instanceof Error ? err.message : "Failed to delete the contact."
        );
      } finally {
        setDeleting(false);
      }
    })();
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg">Contacts</h3>
          <p className="text-sm text-muted-foreground">
            Recruiters and hiring managers at this company.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={openAddForm}>
          <Plus className="size-4" />
          Add contact
        </Button>
      </div>

      {contacts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-8 text-center text-sm text-muted-foreground">
          No contacts yet. Add one to reach out directly.
        </p>
      ) : (
        <ul className="space-y-3">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <UserRound className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{contact.full_name}</span>
                  {contact.job_title && (
                    <span className="text-sm text-muted-foreground">
                      · {contact.job_title}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {contact.email && (
                    <Badge variant="outline" title={contact.email}>
                      <Mail className="size-3" />
                      Email
                    </Badge>
                  )}
                  {contact.phone && (
                    <Badge variant="outline" title={contact.phone}>
                      <Phone className="size-3" />
                      Phone
                    </Badge>
                  )}
                  {contact.linkedin_url && (
                    <Badge variant="outline" title={contact.linkedin_url}>
                      <Linkedin className="size-3" />
                      LinkedIn
                    </Badge>
                  )}
                </div>
                {contact.notes && (
                  <p className="max-w-prose text-sm text-muted-foreground">
                    {contact.notes}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditForm(contact)}
                >
                  <Pencil className="size-4" />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setDeleteError(null);
                    setPendingDelete(contact);
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ContactFormDialog
        companyId={companyId}
        contact={editing}
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={handleSaved}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !deleting && !next && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this contact?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pendingDelete?.full_name} will be permanently removed from this
            company&apos;s contacts. This cannot be undone.
          </p>
          {deleteError && (
            <p
              role="alert"
              className="flex items-center gap-2 text-sm text-destructive"
            >
              <TriangleAlert className="size-4 shrink-0" />
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {deleting ? "Deleting…" : "Delete contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
