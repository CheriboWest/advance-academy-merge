import { getSupabaseClient } from "@/lib/supabase";
import { ALL, type SearchFiltersState } from "@/lib/filters";
import type { CompanySummary, Job } from "@/lib/types";

/** Columns exposed by the `public_company_summary` view. */
const COMPANY_COLUMNS =
  "id, slug, name, website, careers_url, sector, region, hq_location, lead_score, open_jobs, ai_summary, ai_summary_generated_at";

/**
 * Fetch companies from the `public_company_summary` view, applying the public
 * search filters (name search, location, sector) and sort order in the query.
 */
export async function fetchCompanies(
  filters: SearchFiltersState
): Promise<CompanySummary[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from("public_company_summary")
    .select(COMPANY_COLUMNS);

  const q = filters.q.trim();
  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  if (filters.location !== ALL) {
    // Match either the broad region or the specific HQ location.
    query = query.or(
      `region.ilike.%${filters.location}%,hq_location.ilike.%${filters.location}%`
    );
  }

  if (filters.sector !== ALL) {
    query = query.eq("sector", filters.sector);
  }

  switch (filters.sort) {
    case "jobs_desc":
      query = query.order("open_jobs", {
        ascending: false,
        nullsFirst: false,
      });
      break;
    case "name_asc":
      query = query.order("name", { ascending: true });
      break;
    case "score_desc":
    default:
      query = query.order("lead_score", {
        ascending: false,
        nullsFirst: false,
      });
      break;
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CompanySummary[];
}

/** Fetch a single company by its slug, or `null` if none matches. */
export async function fetchCompanyBySlug(
  slug: string
): Promise<CompanySummary | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("public_company_summary")
    .select(COMPANY_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as CompanySummary | null) ?? null;
}

/**
 * Fetch active jobs for a company.
 *
 * Filters on ONLY `company_id` and `is_active = true` — no `posted_at`,
 * `expires_at`, or other conditions — so the count here matches the active-job
 * count exposed by `public_company_summary`. Newest-first ordering for display
 * is applied in memory after the fetch, not as a query condition.
 */
export async function fetchActiveJobs(companyId: string): Promise<Job[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true);

  if (error) {
    throw new Error(error.message);
  }

  const jobs = (data ?? []) as Job[];

  return jobs.sort((a, b) => {
    const aTime = a.posted_at ? new Date(a.posted_at).getTime() : 0;
    const bTime = b.posted_at ? new Date(b.posted_at).getTime() : 0;
    return bTime - aTime;
  });
}

export interface PublicStats {
  companies: number;
  liveJobs: number;
}

/**
 * Headline counts for the landing page. Uses `head: true` so Supabase returns
 * the count without transferring any rows. Counts are best-effort: a failure
 * here must not take the landing page down, so errors collapse to zero and the
 * caller simply omits the figure.
 */
export async function fetchPublicStats(): Promise<PublicStats> {
  const supabase = getSupabaseClient();

  const [companies, jobs] = await Promise.all([
    supabase
      .from("public_company_summary")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
  ]);

  return {
    companies: companies.error ? 0 : companies.count ?? 0,
    liveJobs: jobs.error ? 0 : jobs.count ?? 0,
  };
}
