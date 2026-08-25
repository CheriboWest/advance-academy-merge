import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { CompanySponsorshipStatus } from "@/lib/types";

/**
 * Force a fresh sponsorship check for one company via the FastAPI backend
 * (POST /sponsors/companies/{id}/recheck), and return the resulting status.
 *
 * Same pattern as the other lib/*-api.ts client-side files (e.g.
 * contacts-api.ts): the browser only ever talks to the backend, carrying the
 * signed-in coach's Supabase access token; the backend holds the Anthropic
 * key and does the actual matching.
 */
export async function recheckSponsorshipViaApi(
  companyId: string,
  signal?: AbortSignal
): Promise<CompanySponsorshipStatus> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_API_URL. Set it in apps/web/.env.local to your API URL."
    );
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("You must be signed in to recheck sponsorship.");
  }

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/sponsors/companies/${companyId}/recheck`,
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

  return (await response.json()) as CompanySponsorshipStatus;
}
