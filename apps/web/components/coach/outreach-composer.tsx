"use client";

import * as React from "react";
import {
  CheckCircle2,
  Loader2,
  Save,
  Send,
  Sparkles,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import type { Contact, CompanySponsorshipStatus, SponsoredCompanyContext } from "@/lib/types";
import { generateOutreachViaApi } from "@/lib/outreach-api";
import { sendEmailViaApi } from "@/lib/email-api";
import { saveDraftAction } from "@/app/coach/(workspace)/outreach/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MANUAL_RECIPIENT = "manual";

interface OutreachComposerProps {
  companyId: string;
  company: SponsoredCompanyContext;
  sponsorshipStatus: CompanySponsorshipStatus | null;
  /** Titles of this company's currently open roles — the concrete hiring
   *  signal handed to the AI prompt, not just a count. */
  openJobTitles: string[];
  companyNotes: string | null;
  contacts: Contact[];
  initialSubject: string;
  initialBody: string;
  hasExistingDraft: boolean;
}

type Feedback =
  | { type: "success"; message: string }
  | { type: "error"; message: string }
  | null;

/**
 * Step 3-6 of the Outreach flow: research context for the chosen contact,
 * AI generation grounded in that context, manual editing, and sending
 * through the existing email infrastructure (POST /email/send via the
 * outreach_emails draft, exactly as before contacts/research existed).
 *
 * The coach is always in control: nothing here auto-sends, the generated
 * draft is always editable before Save/Send, and Send is disabled whenever
 * there's no usable recipient address yet.
 */
export function OutreachComposer({
  companyId,
  company,
  sponsorshipStatus,
  openJobTitles,
  companyNotes,
  contacts,
  initialSubject,
  initialBody,
  hasExistingDraft,
}: OutreachComposerProps) {
  const [subject, setSubject] = React.useState(initialSubject);
  const [body, setBody] = React.useState(initialBody);
  const [recipient, setRecipient] = React.useState("");
  const [selectedContactId, setSelectedContactId] =
    React.useState<string>(MANUAL_RECIPIENT);
  const [generating, setGenerating] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [saving, startSaving] = React.useTransition();

  const busy = generating || saving || sending;

  const selectedContact =
    selectedContactId === MANUAL_RECIPIENT
      ? null
      : (contacts.find((contact) => contact.id === selectedContactId) ?? null);

  // A contact was picked, has no email on file, and the coach hasn't typed
  // one in manually either — nothing to send to yet.
  const blockedByContactEmail =
    selectedContact !== null && !selectedContact.email && !recipient.trim();

  function handleSelectContact(contactId: string) {
    setSelectedContactId(contactId);
    if (contactId === MANUAL_RECIPIENT) return;
    const contact = contacts.find((c) => c.id === contactId);
    // Populates the same manual field below, which stays editable — picking
    // a contact is a starting point, not a lock; the coach can still type
    // over it (manual entry always works, contact or no contact).
    setRecipient(contact?.email ?? "");
  }

  function handleGenerate() {
    setGenerating(true);
    setFeedback(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    void (async () => {
      try {
        const generated = await generateOutreachViaApi(
          {
            companyName: company.name,
            location: company.location === "—" ? null : company.location,
            sector: company.sector,
            openJobs: company.open_jobs,
            leadScore: company.lead_score,
            openJobTitles,
            contactName: selectedContact?.full_name ?? null,
            contactRole: selectedContact?.job_title ?? null,
            sponsorshipStatus: sponsorshipStatus?.status ?? null,
            sponsorshipOrganisationName:
              sponsorshipStatus?.match?.organisation_name ?? null,
            companyNotes,
            contactNotes: selectedContact?.notes ?? null,
          },
          controller.signal
        );
        setSubject(generated.subject);
        setBody(generated.body);
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === "AbortError"
            ? "Generation timed out. Please try again."
            : error instanceof Error
              ? error.message
              : "Failed to generate outreach.";
        setFeedback({ type: "error", message });
      } finally {
        window.clearTimeout(timeout);
        setGenerating(false);
      }
    })();
  }

  function handleSave() {
    setFeedback(null);
    startSaving(async () => {
      const result = await saveDraftAction(
        companyId,
        subject,
        body,
        selectedContact?.id
      );
      if (result.ok) {
        setFeedback({ type: "success", message: "Draft saved." });
      } else {
        setFeedback({
          type: "error",
          message: result.error ?? "Something went wrong.",
        });
      }
    });
  }

  function handleSend() {
    setFeedback(null);

    const email = recipient.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFeedback({
        type: "error",
        message: "Enter a valid recipient email address.",
      });
      return;
    }

    setSending(true);
    void (async () => {
      try {
        // Persist the current subject/body (and get a draft id) before
        // sending — including which contact this is addressed to, if any,
        // so the resulting outreach activity record already carries it.
        const saved = await saveDraftAction(
          companyId,
          subject,
          body,
          selectedContact?.id
        );
        if (!saved.ok || !saved.id) {
          setFeedback({
            type: "error",
            message: saved.error ?? "Could not save the draft before sending.",
          });
          return;
        }
        const result = await sendEmailViaApi(saved.id, email);
        setFeedback({
          type: "success",
          message: `Email sent to ${result.recipient_email}.`,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to send the email.";
        setFeedback({ type: "error", message });
      } finally {
        setSending(false);
      }
    })();
  }

  return (
    <section className="space-y-5 rounded-sm border border-border bg-card p-6">
      <div className="space-y-2">
        <label htmlFor="recipient-contact" className="text-sm font-medium">
          Contact
        </label>
        <Select
          value={selectedContactId}
          onValueChange={handleSelectContact}
          disabled={busy}
        >
          <SelectTrigger id="recipient-contact" className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={MANUAL_RECIPIENT}>
              {contacts.length > 0 ? "No contact — enter email manually" : "Enter email manually"}
            </SelectItem>
            {contacts.map((contact) => (
              <SelectItem key={contact.id} value={contact.id}>
                {contact.full_name}
                {contact.job_title ? ` — ${contact.job_title}` : ""}
                {!contact.email ? " (no email on file)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedContact && (
          <div className="flex items-start gap-2 rounded-sm bg-muted/50 p-3 text-sm text-muted-foreground">
            <UserRound className="mt-0.5 size-4 shrink-0" />
            <div>
              <span className="text-foreground">{selectedContact.full_name}</span>
              {selectedContact.job_title && <> · {selectedContact.job_title}</>}
              {selectedContact.notes && <p className="mt-1">{selectedContact.notes}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg">Outreach draft</h3>
          <p className="text-sm text-muted-foreground">
            {hasExistingDraft
              ? "Loaded from your saved draft. Edit and save your changes."
              : "Generate a personalised starting point, then edit before sending."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleGenerate}
          disabled={busy}
        >
          {generating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {generating ? "Generating…" : "Generate with AI"}
        </Button>
      </div>

      <div className="space-y-2">
        <label htmlFor="subject" className="text-sm font-medium">
          Subject
        </label>
        <Input
          id="subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Your outreach subject line"
          disabled={busy}
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="body" className="text-sm font-medium">
          Body
        </label>
        <Textarea
          id="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write or generate your outreach message"
          disabled={busy}
          className="min-h-72"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="recipient" className="text-sm font-medium">
          Send to
        </label>
        <Input
          id="recipient"
          type="email"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder="recruiter@company.com"
          disabled={busy}
          className="h-11"
        />
        {blockedByContactEmail && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="size-3.5 shrink-0" />
            {selectedContact?.full_name} has no email on file — enter one
            above, or choose a different contact.
          </p>
        )}
      </div>

      {feedback && (
        <p
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-sm border px-3 py-2 text-sm",
            feedback.type === "success"
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <TriangleAlert className="size-4 shrink-0" />
          )}
          {feedback.message}
        </p>
      )}

      <div className="flex flex-col justify-end gap-3 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          onClick={handleSave}
          disabled={busy}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {saving ? "Saving…" : "Save draft"}
        </Button>
        <Button
          type="button"
          onClick={handleSend}
          disabled={busy || blockedByContactEmail}
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {sending ? "Sending…" : "Send email"}
        </Button>
      </div>
    </section>
  );
}
