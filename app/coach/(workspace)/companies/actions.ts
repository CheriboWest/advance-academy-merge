"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/shared/auth/supabase-server";

export interface MetaActionResult {
  error: string | null;
}

/** Every route whose content depends on the shared company set. */
const COMPANY_PATHS = [
  "/coach/companies",
  "/coach/dashboard",
  "/coach/sponsored-companies",
  // The Outreach placeholder's "choose a company" step reuses the same
  // company set (see lib/coach.ts's getSponsoredCompanies).
  "/coach/outreach",
] as const;

function revalidateCoachPaths() {
  for (const path of COMPANY_PATHS) revalidatePath(path);
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

  // `.select()` is what makes a no-op distinguishable from a write. Without it
  // PostgREST gets `Prefer: return=minimal` and an upsert that matched no row
  // under RLS comes back indistinguishable from one that inserted.
  const { data, error } = await supabase
    .from("coach_company_meta")
    .upsert(
      {
        coach_user_id: user.id,
        company_id: companyId,
        ...patch,
      },
      { onConflict: "coach_user_id,company_id" }
    )
    .select("company_id");

  if (error) {
    return { error: error.message };
  }

  if (!data || data.length === 0) {
    return {
      error:
        "Saved nothing — the database accepted the request but changed no row. " +
        "Usually means the session did not reach it.",
    };
  }

  revalidateCoachPaths();
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
 * Remove a company from the current coach's list — a per-coach, reversible
 * action, NOT a deletion. It sets `hidden = true` on the coach's own
 * `coach_company_meta` row (guarded by RLS to `auth.uid()`), so the shared
 * `companies` record — and its visibility to students and other coaches — is
 * never touched. The company moves to the "Removed" tab, where
 * {@link restoreCompanyAction} brings it back.
 *
 * Permanent deletion is {@link deleteCompaniesPermanentlyAction}.
 */
export async function hideCompanyAction(
  companyId: string
): Promise<MetaActionResult> {
  return upsertMeta(companyId, { hidden: true });
}

/**
 * Inverse of {@link hideCompanyAction}: restore a company the coach removed by
 * clearing `hidden` on their own `coach_company_meta` row (RLS-guarded to
 * `auth.uid()`). Starred state, notes, and any outreach drafts are preserved —
 * only the `hidden` flag changes.
 */
export async function restoreCompanyAction(
  companyId: string
): Promise<MetaActionResult> {
  return upsertMeta(companyId, { hidden: false });
}

/** Outcome of a permanent deletion, reported per company id. */
export interface DeleteCompaniesResult {
  error: string | null;
  /** Ids after validation and de-duplication. */
  requested: number;
  deleted: number;
  /** Ids that matched no company row — already deleted, or never existed. */
  missing: string[];
  deletedIds: string[];
  deletedJobs: number;
  deletedCoachMeta: number;
  unlinkedOutreachEmails: number;
}

function failedDelete(error: string): DeleteCompaniesResult {
  return {
    error,
    requested: 0,
    deleted: 0,
    missing: [],
    deletedIds: [],
    deletedJobs: 0,
    deletedCoachMeta: 0,
    unlinkedOutreachEmails: 0,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches `MAX_COMPANIES_PER_DELETE` in the API, so the cap fails here first. */
const MAX_COMPANIES_PER_DELETE = 200;

/**
 * Permanently delete companies from the database — for everyone.
 *
 * This is not the per-coach `hidden` flag: the `companies` rows and their jobs
 * are removed outright, so the companies disappear for every coach, for
 * students, from the public search, and from their detail pages. It cannot be
 * undone.
 *
 * The destructive write never happens in the browser and never happens with a
 * coach's own credentials. This action authenticates the coach server-side and
 * forwards their Supabase access token to the API, which verifies the token and
 * calls a `service_role`-only Postgres function that performs the whole
 * deletion — dependants first, company last — in a single transaction. The
 * service role key stays in the API server's environment.
 *
 * Used by both the row-level trash button and the bulk "Delete selected"
 * action; a single deletion is just an array of one.
 */
export async function deleteCompaniesPermanentlyAction(
  companyIds: string[]
): Promise<DeleteCompaniesResult> {
  const ids = Array.from(new Set(companyIds ?? [])).filter(
    (id): id is string => typeof id === "string" && UUID_RE.test(id)
  );

  if (ids.length === 0) {
    return failedDelete("No valid company was selected.");
  }
  if (ids.length > MAX_COMPANIES_PER_DELETE) {
    return failedDelete(
      `Select at most ${MAX_COMPANIES_PER_DELETE} companies to delete at once.`
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    return failedDelete(
      "Missing NEXT_PUBLIC_API_URL. Set it in apps/web/.env.local to your API URL."
    );
  }

  const supabase = await createSupabaseServerClient();

  // `getUser()` verifies the session with Supabase; `getSession()` only supplies
  // the access token to forward. The API verifies that token's signature itself.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return failedDelete("You must be signed in to delete companies.");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return failedDelete("Your session has expired. Sign in again.");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/companies/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ company_ids: ids }),
      cache: "no-store",
    });
  } catch {
    return failedDelete(
      "Could not reach the deletion service. Nothing was deleted."
    );
  }

  if (!response.ok) {
    let detail = `Deletion failed (${response.status}). Nothing was deleted.`;
    try {
      const data = (await response.json()) as { detail?: unknown };
      if (data?.detail) detail = String(data.detail);
    } catch {
      // Non-JSON error body — keep the default message.
    }
    return failedDelete(detail);
  }

  const data = (await response.json()) as {
    requested?: number;
    deleted_companies?: number;
    deleted_company_ids?: string[];
    missing_company_ids?: string[];
    deleted_jobs?: number;
    deleted_coach_meta?: number;
    unlinked_outreach_emails?: number;
  };

  // Deleted companies leave every coach list, the dashboard aggregates, the
  // sponsored-companies list, the public search, the landing page counts, and
  // their own detail/outreach pages — so all of those are revalidated, not
  // just this page.
  revalidateCoachPaths();
  revalidatePath("/search");
  revalidatePath("/");
  revalidatePath("/companies/[slug]", "page");
  revalidatePath("/coach/sponsored-companies/[companyId]", "page");
  revalidatePath("/coach/outreach/[companyId]", "page");

  return {
    error: null,
    requested: data.requested ?? ids.length,
    deleted: data.deleted_companies ?? 0,
    missing: data.missing_company_ids ?? [],
    deletedIds: data.deleted_company_ids ?? [],
    deletedJobs: data.deleted_jobs ?? 0,
    deletedCoachMeta: data.deleted_coach_meta ?? 0,
    unlinkedOutreachEmails: data.unlinked_outreach_emails ?? 0,
  };
}
