"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase-server";

export interface MetaActionResult {
  error: string | null;
}

/**
 * Upsert the current coach's private metadata for a company. RLS ensures a
 * coach can only write their own rows; `coach_user_id` is set to `auth.uid()`.
 */
async function upsertMeta(
  companyId: string,
  patch: { starred?: boolean; notes?: string; hidden?: boolean }
): Promise<MetaActionResult> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in." };
  }

  const { error } = await supabase.from("coach_company_meta").upsert(
    {
      coach_user_id: user.id,
      company_id: companyId,
      ...patch,
    },
    { onConflict: "coach_user_id,company_id" }
  );

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/coach/companies");
  revalidatePath("/coach/dashboard");
  revalidatePath("/coach/outreach");
  return { error: null };
}

export async function toggleStarAction(
  companyId: string,
  starred: boolean
): Promise<MetaActionResult> {
  return upsertMeta(companyId, { starred });
}

export async function saveNotesAction(
  companyId: string,
  notes: string
): Promise<MetaActionResult> {
  return upsertMeta(companyId, { notes });
}

/**
 * Remove a company from the current coach's list. This is a per-coach action:
 * it sets `hidden = true` on the coach's own `coach_company_meta` row (guarded
 * by RLS to `auth.uid()`), so the shared `companies` record — and its
 * visibility to students and other coaches — is never touched. Reversible by
 * clearing the flag.
 */
export async function deleteCompanyAction(
  companyId: string
): Promise<MetaActionResult> {
  return upsertMeta(companyId, { hidden: true });
}

/**
 * Inverse of {@link deleteCompanyAction}: restore a company the coach removed by
 * clearing `hidden` on their own `coach_company_meta` row (RLS-guarded to
 * `auth.uid()`). Starred state, notes, and any outreach drafts are preserved —
 * only the `hidden` flag changes.
 */
export async function restoreCompanyAction(
  companyId: string
): Promise<MetaActionResult> {
  return upsertMeta(companyId, { hidden: false });
}
