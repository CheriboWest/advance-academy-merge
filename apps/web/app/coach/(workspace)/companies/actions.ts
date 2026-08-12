"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase-server";

export interface MetaActionResult {
  error: string | null;
}

/**
 * Upsert the current coach's private metadata for a company. RLS ensures a
 * coach can only write their own rows; `coach_id` is set to `auth.uid()`.
 */
async function upsertMeta(
  companyId: string,
  patch: { starred?: boolean; notes?: string }
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
      coach_id: user.id,
      company_id: companyId,
      ...patch,
    },
    { onConflict: "coach_id,company_id" }
  );

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/coach/companies");
  revalidatePath("/coach/dashboard");
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
