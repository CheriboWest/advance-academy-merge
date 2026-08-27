// Regression test: given the real batch contact-count data for one company
// with 2 contacts, the real <SponsoredCompaniesList> card must render
// "2 contacts" — not "0 contacts". This is the render-layer half of the
// "0 contacts" bug (see lib/contacts.test.ts for the data-layer half, where
// the actual root cause — a missing batch-size cap on getContactCounts — was
// found and fixed).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SponsoredCompaniesList } from "@/components/coach/sponsored-companies-list";
import type { SponsoredCompanyRow } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

const ABSOLUTE_RECRUIT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const ABSOLUTE_RECRUIT: SponsoredCompanyRow = {
  company_id: ABSOLUTE_RECRUIT_ID,
  slug: "absolute-recruit",
  name: "Absolute Recruit",
  location: "London",
  sector: "Recruitment",
  open_jobs: 3,
  lead_score: 50,
};

function card(): HTMLElement {
  const article = screen.getByText("Absolute Recruit").closest("article");
  expect(article).not.toBeNull();
  return article as HTMLElement;
}

describe("SponsoredCompaniesList contact count", () => {
  // The counts now arrive as a promise the server hands over unawaited, so
  // these await the streamed-in text rather than reading it synchronously.
  it("renders the real contact count (2) for a company that has 2 contacts", async () => {
    render(
      <SponsoredCompaniesList
        companies={[ABSOLUTE_RECRUIT]}
        contactCounts={Promise.resolve({ [ABSOLUTE_RECRUIT_ID]: 2 })}
      />
    );

    await screen.findByText("2 contacts");
    expect(card().textContent).not.toContain("0 contacts");
  });

  it("falls back to 0 only when the company is genuinely absent from the count map", async () => {
    render(
      <SponsoredCompaniesList
        companies={[ABSOLUTE_RECRUIT]}
        contactCounts={Promise.resolve({})}
      />
    );

    await screen.findByText("0 contacts");
  });

  // The streaming split (page.tsx hands the counts over as an unawaited
  // promise) introduced a third state that did not exist before: in flight.
  // It must not read as "0 contacts", which is a real answer for a company
  // with none — hence the placeholder rather than a default of 0.
  it("shows a placeholder, not '0 contacts', while the counts are still in flight", () => {
    render(
      <SponsoredCompaniesList
        companies={[ABSOLUTE_RECRUIT]}
        contactCounts={new Promise(() => {})}
      />
    );

    expect(card().textContent).toContain("— contacts");
    expect(card().textContent).not.toContain("0 contacts");
  });
});
