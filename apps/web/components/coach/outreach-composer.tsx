"use client";

import * as React from "react";
import {
  CheckCircle2,
  Loader2,
  Save,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { generateOutreach, type OutreachInput } from "@/lib/outreach";
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
  const [generating, setGenerating] = React.useState(false);
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [saving, startSaving] = React.useTransition();

  function handleGenerate() {
    setGenerating(true);
    setFeedback(null);
    // Brief pause purely for UX feedback — generation itself is synchronous.
    window.setTimeout(() => {
      const generated = generateOutreach(input);
      setSubject(generated.subject);
      setBody(generated.body);
      setGenerating(false);
    }, 400);
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
          disabled={generating || saving}
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
          disabled={generating || saving}
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
          disabled={generating || saving}
          className="min-h-72 rounded-2xl"
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

      <div className="flex justify-end">
        <Button
          type="button"
          className="rounded-xl"
          onClick={handleSave}
          disabled={saving || generating}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {saving ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </section>
  );
}
