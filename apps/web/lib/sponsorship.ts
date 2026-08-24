import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { CompanySponsorshipStatus } from "@/lib/types";

/**
 * This company's sponsorship status, from the FastAPI backend
 * (GET /sponsors/companies/{id}) — never a direct Supabase read. The
 * sponsorship tables are deny-by-default RLS, service-role-only; the backend
 * is the only thing allowed to query them, and it returns one of five
 * normalized states, never the raw register/check rows.
 *
 * Never throws. A missing session, a network failure, or a non-2xx response
 * all resolve to `null` rather than breaking the page that embeds this — the
 * Sponsorship card renders its own "Check unavailable" state for `null`,
 * matching how a genuine backend `status: "error"` renders. The one
 * exception is a 404 (company not found), which is also `null`: from this
 * card's point of view there is nothing to show either way.
 */
export async function getSponsorshipStatus(
  companyId: string
): Promise<CompanySponsorshipStatus | null> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) return null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/sponsors/companies/${companyId}`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      }
    );
    if (!response.ok) return null;
    return (await response.json()) as CompanySponsorshipStatus;
  } catch {
    return null;
  }
}
