"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase-server";

export interface SaveDraftResult {
  ok: boolean;
  error: string | null;
}

/**
 * Save (or update) the current coach's outreach draft for a company.
 *
 * Drafts are one-per-(coach, company): if one already exists it is updated in
 * place, otherwise a new row is inserted with status = 'draft'. RLS ensures a
 * coach can only read and write their own rows.
 */
export async function saveDraftAction(
  companyId: string,
  subject: string,
  body: string
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

  if (existing?.id) {
    const { error } = await supabase
      .from("outreach_emails")
      .update({ subject: trimmedSubject, body: trimmedBody, status: "draft" })
      .eq("id", existing.id);
    if (error) {
      return { ok: false, error: error.message };
    }
  } else {
    const { error } = await supabase.from("outreach_emails").insert({
      coach_user_id: user.id,
      company_id: companyId,
      subject: trimmedSubject,
      body: trimmedBody,
      status: "draft",
    });
    if (error) {
      return { ok: false, error: error.message };
    }
  }

  revalidatePath("/coach/outreach");
  revalidatePath(`/coach/outreach/${companyId}`);
  return { ok: true, error: null };
}
