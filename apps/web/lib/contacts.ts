import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Contact } from "@/lib/types";

/**
 * A company's contacts, or a batch across several, from the FastAPI backend
 * (GET /contacts) — never a direct Supabase read. See the `Contact` type for
 * why: the `contacts` table is deny-by-default RLS, service-role-only,
 * reachable only through the backend.
 *
 * Server-only (imports next/headers via supabase-server) — for mutations
 * from a client component, see lib/contacts-api.ts, exactly as
 * lib/sponsorship.ts (server reads) and lib/sponsorship-api.ts (client
 * writes) are split.
 *
 * Never throws. A missing session, a network failure, or a non-2xx response
 * all resolve to an empty list — a page using this still renders, just
 * without contacts, rather than failing outright.
 */
async function fetchContacts(query: string): Promise<Contact[]> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) return [];

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return [];

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/contacts?${query}`,
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

export async function getContacts(companyId: string): Promise<Contact[]> {
  return fetchContacts(`company_id=${encodeURIComponent(companyId)}`);
}

/**
 * Contact count per company, for the Sponsored Companies list's "N contacts"
 * signal — one batched request rather than one per row. Companies with zero
 * contacts are simply absent from the result (not present with a 0), so
 * callers should default a missing id to 0.
 */
export async function getContactCounts(
  companyIds: string[]
): Promise<Record<string, number>> {
  if (companyIds.length === 0) return {};

  const contacts = await fetchContacts(
    `company_ids=${encodeURIComponent(companyIds.join(","))}`
  );

  const counts: Record<string, number> = {};
  for (const contact of contacts) {
    counts[contact.company_id] = (counts[contact.company_id] ?? 0) + 1;
  }
  return counts;
}
