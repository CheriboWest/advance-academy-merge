"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/shared/auth/supabase-server";
import type { OutreachStoredStatus } from "@/features/career-hub/lib/types";

export interface SaveDraftResult {
  ok: boolean;
  error: string | null;
  /** The id of the saved draft row, present when ok is true. */
  id?: string;
}

export interface ActionResult {
  ok: boolean;
  error: string | null;
}

function revalidateOutreachPaths(companyId: string) {
  revalidatePath("/coach/outreach");
  revalidatePath(`/coach/outreach/${companyId}`);
  revalidatePath(`/coach/sponsored-companies/${companyId}`);
}

/**
 * Save (or update) the current coach's outreach draft for a company.
 *
 * Drafts are one-per-(coach, company): if one already exists it is updated in
 * place, otherwise a new row is inserted with status = 'draft'. RLS ensures a
 * coach can only read and write their own rows.
 *
 * `contactId` (optional — omitted for a manually-typed recipient) is stored
 * alongside subject/body so that when this draft is later sent, the outreach
 * activity record it becomes already knows which contact it was addressed
 * to, rather than that link only ever existing in the composer's client state.
 */
export async function saveDraftAction(
  companyId: string,
  subject: string,
  body: string,
  contactId?: string | null
): Promise<SaveDraftResult> {
  const trimmedSubject = subject.trim();
  const trimmedBody = body.trim();

  if (!trimmedSubject && !trimmedBody) {
    return { ok: false, error: "Add a subject or body before saving." };
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data: existing, error: lookupError } = await supabase
    .from("outreach_emails")
    .select("id")
    .eq("coach_user_id", user.id)
    .eq("company_id", companyId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    return { ok: false, error: lookupError.message };
  }

  let draftId: string;

  if (existing?.id) {
    const { data, error } = await supabase
      .from("outreach_emails")
      .update({
        subject: trimmedSubject,
        body: trimmedBody,
        status: "draft",
        contact_id: contactId ?? null,
      })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) {
      return { ok: false, error: error.message };
    }
    draftId = data.id as string;
  } else {
    const { data, error } = await supabase
      .from("outreach_emails")
      .insert({
        coach_user_id: user.id,
        company_id: companyId,
        subject: trimmedSubject,
        body: trimmedBody,
        status: "draft",
        contact_id: contactId ?? null,
      })
      .select("id")
      .single();
    if (error) {
      return { ok: false, error: error.message };
    }
    draftId = data.id as string;
  }

  revalidateOutreachPaths(companyId);
  return { ok: true, error: null, id: draftId };
}

/**
 * Shared update helper for the four coach actions below: all touch one
 * outreach_emails row by id, scoped to the caller (RLS enforces this is
 * always true, but the explicit filter documents the intent and gives a
 * predictable "no such row" result if it somehow isn't).
 */
async function updateActivity(
  activityId: string,
  values: Record<string, unknown>
): Promise<{ ok: boolean; error: string | null; companyId?: string }> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data, error } = await supabase
    .from("outreach_emails")
    .update(values)
    .eq("id", activityId)
    .eq("coach_user_id", user.id)
    .select("company_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: "Outreach activity not found." };
  }

  return { ok: true, error: null, companyId: data.company_id as string };
}

/** Mark an outreach activity as replied to — manual, coach-driven; there is
 *  no inbox/reply detection in this milestone. */
export async function markRepliedAction(activityId: string): Promise<ActionResult> {
  const result = await updateActivity(activityId, {
    status: "replied" satisfies OutreachStoredStatus,
  });
  if (result.ok && result.companyId) revalidateOutreachPaths(result.companyId);
  return { ok: result.ok, error: result.error };
}

/** Close an outreach activity — no reply expected/needed, nothing further
 *  to track. */
export async function closeOutreachAction(activityId: string): Promise<ActionResult> {
  const result = await updateActivity(activityId, {
    status: "closed" satisfies OutreachStoredStatus,
  });
  if (result.ok && result.companyId) revalidateOutreachPaths(result.companyId);
  return { ok: result.ok, error: result.error };
}

/** Set or clear the follow-up date. Passing `null` clears it — this does
 *  NOT change status; "follow_up_due" is a computed display state (see
 *  lib/outreach-activity.ts), not something set directly here. */
export async function setFollowUpAction(
  activityId: string,
  followUpAt: string | null
): Promise<ActionResult> {
  const result = await updateActivity(activityId, { follow_up_at: followUpAt });
  if (result.ok && result.companyId) revalidateOutreachPaths(result.companyId);
  return { ok: result.ok, error: result.error };
}

/** Save the coach's notes on this specific outreach attempt (distinct from
 *  a company's or contact's own notes). */
export async function saveOutreachNotesAction(
  activityId: string,
  notes: string
): Promise<ActionResult> {
  const result = await updateActivity(activityId, { notes: notes.trim() || null });
  if (result.ok && result.companyId) revalidateOutreachPaths(result.companyId);
  return { ok: result.ok, error: result.error };
}
