"use client";

import * as React from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import type { Contact, ContactInput } from "@/lib/types";
import { createContactViaApi, updateContactViaApi } from "@/lib/contacts-api";
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

interface ContactFormDialogProps {
  companyId: string;
  /** `null` adds a new contact; a `Contact` edits that one. */
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (contact: Contact) => void;
}

const EMPTY_INPUT: ContactInput = {
  full_name: "",
  job_title: null,
  email: null,
  phone: null,
  linkedin_url: null,
  notes: null,
};

function toInput(contact: Contact | null): ContactInput {
  if (!contact) return EMPTY_INPUT;
  return {
    full_name: contact.full_name,
    job_title: contact.job_title,
    email: contact.email,
    phone: contact.phone,
    linkedin_url: contact.linkedin_url,
    notes: contact.notes,
  };
}

/**
 * Add or edit a company contact — one dialog for both modes (keyed by
 * whether `contact` is null), so the fields and the "needs a contact method"
 * validation live in exactly one place rather than two near-duplicates.
 *
 * Client-side validation mirrors the backend's (see ContactWrite in
 * schemas.py) so the common mistakes are caught before a round trip, but the
 * backend is still the source of truth — its 422 message is shown verbatim
 * if something client-side validation missed.
 */
export function ContactFormDialog({
  companyId,
  contact,
  open,
  onOpenChange,
  onSaved,
}: ContactFormDialogProps) {
  const [form, setForm] = React.useState<ContactInput>(() => toInput(contact));
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setForm(toInput(contact));
      setError(null);
    }
  }, [open, contact]);

  function set(key: keyof ContactInput, value: string) {
    setForm((prev) => ({ ...prev, [key]: value === "" ? null : value }));
  }

  function handleSave() {
    setError(null);

    if (!form.full_name.trim()) {
      setError("Enter a name.");
      return;
    }
    if (!form.email && !form.phone && !form.linkedin_url) {
      setError("Add at least one contact method: email, phone, or LinkedIn.");
      return;
    }

    setSaving(true);
    void (async () => {
      try {
        const saved = contact
          ? await updateContactViaApi(contact.id, form)
          : await createContactViaApi(companyId, form);
        onSaved(saved);
        onOpenChange(false);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to save the contact."
        );
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>
            At least one of email, phone, or LinkedIn is required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="contact-full-name" className="text-sm font-medium">
              Full name
            </label>
            <Input
              id="contact-full-name"
              value={form.full_name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, full_name: event.target.value }))
              }
              placeholder="Jamie Lee"
              disabled={saving}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="contact-job-title" className="text-sm font-medium">
              Role
            </label>
            <Input
              id="contact-job-title"
              value={form.job_title ?? ""}
              onChange={(event) => set("job_title", event.target.value)}
              placeholder="Hiring Manager"
              disabled={saving}
              className="h-11"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="contact-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="contact-email"
                type="email"
                value={form.email ?? ""}
                onChange={(event) => set("email", event.target.value)}
                placeholder="jamie@company.com"
                disabled={saving}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="contact-phone" className="text-sm font-medium">
                Phone
              </label>
              <Input
                id="contact-phone"
                type="tel"
                value={form.phone ?? ""}
                onChange={(event) => set("phone", event.target.value)}
                placeholder="020 7946 0958"
                disabled={saving}
                className="h-11"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="contact-linkedin" className="text-sm font-medium">
              LinkedIn URL
            </label>
            <Input
              id="contact-linkedin"
              type="url"
              value={form.linkedin_url ?? ""}
              onChange={(event) => set("linkedin_url", event.target.value)}
              placeholder="https://linkedin.com/in/jamielee"
              disabled={saving}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="contact-notes" className="text-sm font-medium">
              Notes
            </label>
            <Textarea
              id="contact-notes"
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
              placeholder="How you know them, best way to reach out…"
              disabled={saving}
              className="min-h-24"
            />
          </div>
        </div>

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
            <Button variant="outline" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Saving…" : contact ? "Save changes" : "Add contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
