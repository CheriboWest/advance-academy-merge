import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Contact } from "@/lib/types";

/**
 * A company's contacts, from the FastAPI backend (GET /contacts) — never a
 * direct Supabase read. See the `Contact` type for why: the `contacts` table
 * is deny-by-default RLS, service-role-only, reachable only through the
 * backend.
 *
 * Server-only (imports next/headers via supabase-server) — for mutations
 * from a client component, see lib/contacts-api.ts, exactly as
 * lib/sponsorship.ts (server reads) and lib/sponsorship-api.ts (client
 * writes) are split.
 *
 * Never throws. A missing session, a network failure, or a non-2xx response
 * all resolve to an empty list — the composer page still renders, just
 * without contacts, rather than the whole page failing.
 */
export async function getContacts(companyId: string): Promise<Contact[]> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) return [];

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return [];

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/contacts?company_id=${encodeURIComponent(companyId)}`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      }
    );
    if (!response.ok) return [];
    return (await response.json()) as Contact[];
  } catch {
    return [];
  }
}
