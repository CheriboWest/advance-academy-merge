import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getHiddenCompanyIds } from "@/lib/coach";
import { ALL, type SearchFiltersState } from "@/lib/filters";
import type { CompanyRoleResult } from "@/lib/types";

/** Columns exposed by the `public_company_summary` view. */
const COMPANY_COLUMNS =
  "id, slug, name, website, careers_url, sector, region, hq_location, lead_score, open_jobs, ai_summary, ai_summary_generated_at";

// Defensive cap on the matching-jobs scan. A single role search should never
// return anywhere near this many jobs; the cap only prevents a pathological
// query (e.g. a one-character term) from pulling an unbounded set. If it is hit,
// matching counts for the busiest companies may be undercounted.
const MATCHING_JOBS_CAP = 2000;

/** Escape LIKE/ILIKE wildcards so the term is matched literally. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Job Role Search: find companies with ACTIVE jobs whose title matches the
 * search term, returned as unique companies with a `matching_jobs` count.
 *
 * Flow:
 *   1. jobs: select company_id where is_active AND title ILIKE %role%  (SQL-side)
 *   2. aggregate → unique company_id + matching count (dedup)
 *   3. coaches only: drop the coach's hidden companies (reused helper)
 *   4. public_company_summary: .in(id, ids) + sector/location/sort
 *   5. attach matching_jobs
 *
 * Uses the cookie-aware server client so the same code serves students (anon
 * role) and coaches (authenticated role) under the existing `jobs` RLS policy
 * ("Public can read active jobs"). Hidden-company filtering applies only when a
 * signed-in coach is present, so public/student results are unaffected.
 */
export async function fetchCompaniesByRole(
  filters: SearchFiltersState
): Promise<CompanyRoleResult[]> {
  const role = filters.q.trim();
  if (!role) return [];

  const supabase = await createSupabaseServerClient();

  // 1. Matching active jobs → company ids (projection of a filtered set only).
  const { data: jobRows, error: jobsError } = await supabase
    .from("jobs")
    .select("company_id")
    .eq("is_active", true)
    .ilike("title", `%${escapeLike(role)}%`)
    .limit(MATCHING_JOBS_CAP);

  if (jobsError) throw new Error(jobsError.message);

  // 2. Dedup + count matches per company.
  const matchesByCompany = new Map<string, number>();
  for (const row of jobRows ?? []) {
    const companyId = row.company_id as string | null;
    if (!companyId) continue;
    matchesByCompany.set(companyId, (matchesByCompany.get(companyId) ?? 0) + 1);
  }
  if (matchesByCompany.size === 0) return [];

  // 3. Coaches: never surface a company they've removed. No-op for students
  //    (getUser() is null without a coach session), so public results stand.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const hiddenIds = await getHiddenCompanyIds(supabase);
    for (const id of hiddenIds) matchesByCompany.delete(id);
    if (matchesByCompany.size === 0) return [];
  }

  const companyIds = [...matchesByCompany.keys()];

  // 4. Company fields (incl. open_jobs) from the view, narrowed to the matches,
  //    with the SAME sector/location/sort semantics as company-name search.
  let query = supabase
    .from("public_company_summary")
    .select(COMPANY_COLUMNS)
    .in("id", companyIds);

  if (filters.sector !== ALL) {
    query = query.eq("sector", filters.sector);
  }
  if (filters.location !== ALL) {
    query = query.or(
      `region.ilike.%${filters.location}%,hq_location.ilike.%${filters.location}%`
    );
  }

  switch (filters.sort) {
    case "jobs_desc":
      query = query.order("open_jobs", { ascending: false, nullsFirst: false });
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
  if (error) throw new Error(error.message);

  // 5. Attach the matching-job count (distinct from open_jobs).
  return (data ?? []).map((company) => ({
    ...(company as CompanyRoleResult),
    matching_jobs: matchesByCompany.get(company.id as string) ?? 0,
  }));
}
