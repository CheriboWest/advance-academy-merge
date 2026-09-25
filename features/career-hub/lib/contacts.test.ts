// Regression test for "Sponsored Companies shows 0 contacts even though the
// company detail page has real contacts for that same company_id."
//
// Root cause (found by tracing the real getContactsForCompanies/
// getContactCounts code against the real FastAPI /contacts router — see the
// investigation notes in the fix commit): app/routers/contacts.py rejects a
// `company_ids` batch over MAX_COMPANY_IDS_PER_LIST (500) with a 422, and
// fetchContacts() below treats any non-2xx response as "no contacts". Once a
// coach's (unpaginated) company list passed 500 entries, the ENTIRE batch
// request 422'd, so getContactCounts silently returned {} for every company
// on the page — including ones with real contacts — while each company's own
// detail page kept working, because it queries `company_id=` (singular),
// which carries no such cap.
//
// getContactsForCompanies now chunks by the same 500-id limit the backend
// enforces (mirroring lib/sponsorship.ts's getSponsorshipStatuses), so a
// large company list is several requests instead of one the backend refuses
// outright.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/auth/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      async getSession() {
        return { data: { session: { access_token: "fake-token" } } };
      },
    },
  }),
}));

const ABSOLUTE_RECRUIT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeContact(id: string, companyId: string) {
  return {
    id,
    company_id: companyId,
    full_name: `Contact ${id}`,
    job_title: null,
    email: `${id}@example.com`,
    phone: null,
    linkedin_url: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

/** Stands in for the real app/routers/contacts.py: two real contacts for
 *  Absolute Recruit, and enforces the same MAX_COMPANY_IDS_PER_LIST=500 cap
 *  the real backend does — a `company_ids` request over that many ids is a
 *  422, exactly like the real router. */
function installFakeBackend() {
  const CONTACTS = [
    makeContact("c1", ABSOLUTE_RECRUIT_ID),
    makeContact("c2", ABSOLUTE_RECRUIT_ID),
  ];
  const MAX_COMPANY_IDS_PER_LIST = 500;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = new URL(url.toString());
      const companyId = u.searchParams.get("company_id");
      const companyIds = u.searchParams.get("company_ids");

      if (companyId) {
        return jsonResponse(CONTACTS.filter((c) => c.company_id === companyId));
      }
      if (companyIds) {
        const ids = companyIds.split(",").filter(Boolean);
        if (ids.length > MAX_COMPANY_IDS_PER_LIST) {
          return new Response(
            JSON.stringify({
              detail: `Provide at most ${MAX_COMPANY_IDS_PER_LIST} company_ids.`,
            }),
            { status: 422 }
          );
        }
        const idSet = new Set(ids);
        return jsonResponse(CONTACTS.filter((c) => idSet.has(c.company_id)));
      }
      return new Response(JSON.stringify({ detail: "Provide company_id or company_ids." }), {
        status: 422,
      });
    })
  );
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("contact counts for Sponsored Companies", () => {
  it("one company with 2 real contacts: batch count map has 2 for that company", async () => {
    installFakeBackend();
    process.env.CAREERHUB_API_URL = "http://fake-api.test";

    const { getContactCounts, getContacts } = await import("@/features/career-hub/lib/contacts");

    const detail = await getContacts(ABSOLUTE_RECRUIT_ID);
    expect(detail).toHaveLength(2);

    const counts = await getContactCounts([ABSOLUTE_RECRUIT_ID]);
    expect(counts[ABSOLUTE_RECRUIT_ID]).toBe(2);
  });

  it("a large company list (>500 ids) still reports the real count for a " +
      "company with contacts, instead of every company silently going to 0",
    async () => {
      installFakeBackend();
      process.env.CAREERHUB_API_URL = "http://fake-api.test";

      const { getContactCounts, getContacts } = await import("@/features/career-hub/lib/contacts");

      const manyOtherIds = Array.from({ length: 500 }, (_, i) =>
        `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`
      );
      const companyIds = [...manyOtherIds, ABSOLUTE_RECRUIT_ID];
      expect(companyIds.length).toBe(501);

      const counts = await getContactCounts(companyIds);

      // Before the chunking fix, this whole request 422'd and `counts` was
      // `{}` — Absolute Recruit's card would show 0 despite having 2 real
      // contacts, exactly matching the reported bug, while the detail page
      // below (unaffected by the batch cap) kept showing the real count.
      expect(counts[ABSOLUTE_RECRUIT_ID]).toBe(2);

      const detail = await getContacts(ABSOLUTE_RECRUIT_ID);
      expect(detail).toHaveLength(2);
    }
  );
});
