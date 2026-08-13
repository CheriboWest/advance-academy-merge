"use client";

import * as React from "react";
import {
  CheckCircle2,
  Loader2,
  Save,
  Send,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import type { OutreachInput } from "@/lib/outreach";
import { generateOutreachViaApi } from "@/lib/outreach-api";
import { sendEmailViaApi } from "@/lib/email-api";
import { saveDraftAction } from "@/app/coach/(workspace)/outreach/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface OutreachComposerProps {
  companyId: string;
  input: OutreachInput;
  initialSubject: string;
  initialBody: string;
  hasExistingDraft: boolean;
}

type Feedback =
  | { type: "success"; message: string }
  | { type: "error"; message: string }
  | null;

export function OutreachComposer({
  companyId,
  input,
  initialSubject,
  initialBody,
  hasExistingDraft,
}: OutreachComposerProps) {
  const [subject, setSubject] = React.useState(initialSubject);
  const [body, setBody] = React.useState(initialBody);
  const [recipient, setRecipient] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [saving, startSaving] = React.useTransition();

  const busy = generating || saving || sending;

  function handleGenerate() {
    setGenerating(true);
    setFeedback(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    void (async () => {
      try {
        const generated = await generateOutreachViaApi(input, controller.signal);
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
      const result = await saveDraftAction(companyId, subject, body);
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
        // Persist the current subject/body (and get a draft id) before sending.
        const saved = await saveDraftAction(companyId, subject, body);
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
    <section className="space-y-5 rounded-3xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">
            Outreach draft
          </h3>
          <p className="text-sm text-muted-foreground">
            {hasExistingDraft
              ? "Loaded from your saved draft. Edit and save your changes."
              : "Generate a starting point, then edit before saving."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
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
          className="h-11 rounded-xl"
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
          className="min-h-72 rounded-2xl"
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
          className="h-11 rounded-xl"
        />
      </div>

      {feedback && (
        <p
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
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
          className="rounded-xl"
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
          className="rounded-xl"
          onClick={handleSend}
          disabled={busy}
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
