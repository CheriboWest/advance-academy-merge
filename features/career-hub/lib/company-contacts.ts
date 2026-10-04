import type { CompanyContactSummary } from "@advance-academy/contracts/contacts";
import { getServerEnv } from "@/shared/env/server";

/**
 * Contact counts for the public company page's locked "Contacts" teaser.
 * Server-only, no token: the backend route is public because it carries no
 * personal data. Never throws — on any failure the page simply shows no
 * Contacts section, rather than advertising contacts it can't confirm.
 */
export async function fetchContactSummary(
  companyId: string
): Promise<CompanyContactSummary | null> {
  const { backendUrl } = getServerEnv();
  try {
    const res = await fetch(
      `${backendUrl}/api/public/company-contacts/${encodeURIComponent(companyId)}/summary`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) }
    );
    return res.ok ? ((await res.json()) as CompanyContactSummary) : null;
  } catch {
    return null;
  }
}
