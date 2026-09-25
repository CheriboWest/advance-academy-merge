import { getSupabaseBrowser } from "@/shared/auth/supabase-browser";
import { CAREERHUB_PROXY } from "@/features/career-hub/lib/api-url";

export interface CompanySummaryRefreshResult {
  company_id: string;
  ai_summary: string;
  ai_summary_generated_at: string;
}

/**
 * Force a fresh summary regeneration for one company via the FastAPI backend
 * (POST /companies/{id}/summary/refresh), and return the resulting summary.
 *
 * Same pattern as lib/sponsorship-api.ts's recheckSponsorshipViaApi: the
 * browser only ever talks to the backend, carrying the signed-in coach's
 * Supabase access token; the backend holds the Anthropic key and does the
 * actual generation and storage.
 */
export async function refreshCompanySummaryViaApi(
  companyId: string,
  signal?: AbortSignal
): Promise<CompanySummaryRefreshResult> {
  const supabase = getSupabaseBrowser();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("You must be signed in to refresh a company summary.");
  }

  const response = await fetch(
    `${CAREERHUB_PROXY}/companies/${companyId}/summary/refresh`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal,
    }
  );

  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    try {
      const data = (await response.json()) as { detail?: unknown };
      if (data?.detail) detail = String(data.detail);
    } catch {
      // Non-JSON error body — keep the default message.
    }
    throw new Error(detail);
  }

  return (await response.json()) as CompanySummaryRefreshResult;
}
