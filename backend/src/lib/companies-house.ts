/**
 * Companies House (UK) REST client — sprint F6a.
 *
 * Free official register of UK companies: legal name, company number, status,
 * incorporation date, registered address, SIC codes. Useful wherever we need to
 * confirm a company is real and get its canonical name rather than trusting a
 * job ad — Dream Company and Outreach are the obvious consumers.
 *
 * Auth is HTTP Basic with the API key as the USERNAME and an empty password —
 * not a bearer token, which is the usual first thing to get wrong here.
 *
 * Optional integration: when `COMPANIES_HOUSE_API_KEY` is unset, callers should
 * check `isCompaniesHouseConfigured()` and skip rather than fail. Calling anyway
 * throws a clear, actionable error instead of a confusing 401.
 */

const BASE_URL = 'https://api.company-information.service.gov.uk';
const DEFAULT_TIMEOUT_MS = 10000;

export interface CompanySearchHit {
  companyNumber: string;
  title: string;
  companyStatus: string | null;
  companyType: string | null;
  address: string | null;
}

export interface CompanyProfile {
  companyNumber: string;
  companyName: string;
  companyStatus: string | null;
  companyType: string | null;
  dateOfCreation: string | null;
  registeredAddress: string | null;
  sicCodes: string[];
}

export function isCompaniesHouseConfigured(): boolean {
  return Boolean(process.env.COMPANIES_HOUSE_API_KEY?.trim());
}

function authHeader(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY?.trim();
  if (!key) {
    throw Object.assign(
      new Error('COMPANIES_HOUSE_API_KEY is not set — register at https://developer.company-information.service.gov.uk/'),
      { statusCode: 500, step: 'companies-house-config' },
    );
  }
  // Basic auth: key as username, blank password.
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

async function chFetch<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('Companies House rejected the API key (401/403).'), {
      statusCode: 502,
      step: 'companies-house-auth',
    });
  }
  if (res.status === 429) {
    // Documented allowance is 600 requests per 5 minutes per key.
    throw Object.assign(new Error('Companies House rate limit hit.'), {
      statusCode: 429,
      step: 'companies-house-rate-limit',
    });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`Companies House request failed (${res.status}).`), {
      statusCode: 502,
      step: 'companies-house-request',
    });
  }
  return (await res.json()) as T;
}

interface RawSearchResponse {
  items?: {
    company_number?: string;
    title?: string;
    company_status?: string;
    company_type?: string;
    address_snippet?: string;
  }[];
}

/** Search the register by name. Returns [] for a blank query rather than calling out. */
export async function searchCompanies(query: string, limit = 10): Promise<CompanySearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  const params = new URLSearchParams({
    q,
    items_per_page: String(Math.min(Math.max(limit, 1), 100)),
  });
  const data = await chFetch<RawSearchResponse>(`/search/companies?${params.toString()}`);

  return (data.items ?? [])
    .filter((i) => i.company_number)
    .map((i) => ({
      companyNumber: i.company_number as string,
      title: i.title ?? '',
      companyStatus: i.company_status ?? null,
      companyType: i.company_type ?? null,
      address: i.address_snippet ?? null,
    }));
}

interface RawProfileResponse {
  company_number?: string;
  company_name?: string;
  company_status?: string;
  type?: string;
  date_of_creation?: string;
  sic_codes?: string[];
  registered_office_address?: Record<string, string | undefined>;
}

/** Full profile for one company number (e.g. "00445790"). */
export async function getCompanyProfile(companyNumber: string): Promise<CompanyProfile | null> {
  const num = companyNumber.trim().toUpperCase();
  if (!num) return null;

  const data = await chFetch<RawProfileResponse>(`/company/${encodeURIComponent(num)}`);
  const addr = data.registered_office_address ?? {};
  const registeredAddress =
    [addr.address_line_1, addr.address_line_2, addr.locality, addr.region, addr.postal_code]
      .filter(Boolean)
      .join(', ') || null;

  return {
    companyNumber: data.company_number ?? num,
    companyName: data.company_name ?? '',
    companyStatus: data.company_status ?? null,
    companyType: data.type ?? null,
    dateOfCreation: data.date_of_creation ?? null,
    registeredAddress,
    sicCodes: data.sic_codes ?? [],
  };
}
