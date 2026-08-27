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

// Matches MAX_COMPANY_IDS_PER_LIST in app/routers/contacts.py — a single
// `company_ids` request over that cap is rejected outright (422), same
// constraint `sponsorship.ts`'s getSponsorshipStatuses chunks around. Without
// this, a coach whose (unpaginated — see getSponsoredCompanies) company list
// grows past 500 gets one oversized request that 422s in full: fetchContacts
// treats any non-2xx as "no contacts", so *every* company's card on the
// Sponsored Companies list silently shows 0 contacts, including ones with
// real contacts — while each company's own detail page keeps working, since
// it queries a single `company_id=`, never `company_ids=`, and so never hits
// this cap.
const CHUNK_SIZE = 500;

/**
 * Every contact across several companies — for the Outreach activity
 * dashboard, which needs to show a contact's name/role next to each outreach
 * row without an N+1 (one request per distinct company), and for
 * `getContactCounts` below. Chunked so a large company set is several
 * requests rather than one the backend rejects outright.
 */
export async function getContactsForCompanies(
  companyIds: string[]
): Promise<Contact[]> {
  if (companyIds.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < companyIds.length; i += CHUNK_SIZE) {
    chunks.push(companyIds.slice(i, i + CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      fetchContacts(`company_ids=${encodeURIComponent(chunk.join(","))}`)
    )
  );
  return results.flat();
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

  const contacts = await getContactsForCompanies(companyIds);

  const counts: Record<string, number> = {};
  for (const contact of contacts) {
    counts[contact.company_id] = (counts[contact.company_id] ?? 0) + 1;
  }
  return counts;
}
