import type { User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  CoachCompanyRow,
  CoachDashboardData,
  CompanySummary,
} from "@/lib/types";

const COMPANY_COLUMNS =
  "id, slug, name, website, careers_url, sector, region, hq_location, lead_score, open_jobs";

const HIGH_SCORE_THRESHOLD = 80;

/** The authenticated coach, or `null`. Server-side session check. */
export async function getCoachUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Aggregate all data shown on the coach dashboard. */
export async function getDashboardData(): Promise<CoachDashboardData> {
  const supabase = await createSupabaseServerClient();

  const [
    totalResult,
    highScoreResult,
    jobsResult,
    recentResult,
    topHiringResult,
  ] = await Promise.all([
    supabase
      .from("public_company_summary")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("public_company_summary")
      .select("*", { count: "exact", head: true })
      .gte("lead_score", HIGH_SCORE_THRESHOLD),
    supabase.from("public_company_summary").select("open_jobs"),
    // The view exposes no timestamp column, so we approximate "recent" by id.
    supabase
      .from("public_company_summary")
      .select(COMPANY_COLUMNS)
      .order("id", { ascending: false })
      .limit(10),
    supabase
      .from("public_company_summary")
      .select(COMPANY_COLUMNS)
      .order("open_jobs", { ascending: false, nullsFirst: false })
      .limit(5),
  ]);

  const firstError =
    totalResult.error ||
    highScoreResult.error ||
    jobsResult.error ||
    recentResult.error ||
    topHiringResult.error;
  if (firstError) {
    throw new Error(firstError.message);
  }

  const totalActiveJobs = (jobsResult.data ?? []).reduce(
    (sum, row) => sum + ((row.open_jobs as number | null) ?? 0),
    0
  );

  return {
    totalCompanies: totalResult.count ?? 0,
    highScoreCompanies: highScoreResult.count ?? 0,
    totalActiveJobs,
    recentCompanies: (recentResult.data ?? []) as CompanySummary[],
    topHiringCompanies: (topHiringResult.data ?? []) as CompanySummary[],
  };
}

/**
 * All companies merged with the current coach's private metadata (starred +
 * notes). The metadata query is limited to the coach's own rows by RLS.
 */
export async function getCoachCompanies(): Promise<CoachCompanyRow[]> {
  const supabase = await createSupabaseServerClient();

  const [companiesResult, metaResult] = await Promise.all([
    supabase
      .from("public_company_summary")
      .select("id, slug, name, region, hq_location, open_jobs, lead_score")
      .order("name", { ascending: true }),
    supabase.from("coach_company_meta").select("company_id, starred, notes"),
  ]);

  if (companiesResult.error) throw new Error(companiesResult.error.message);
  if (metaResult.error) throw new Error(metaResult.error.message);

  const metaByCompany = new Map(
    (metaResult.data ?? []).map((meta) => [meta.company_id as string, meta])
  );

  return (companiesResult.data ?? []).map((company) => {
    const meta = metaByCompany.get(company.id as string);
    return {
      company_id: company.id as string,
      slug: company.slug as string,
      name: company.name as string,
      location:
        (company.hq_location as string | null) ??
        (company.region as string | null) ??
        "—",
      open_jobs: (company.open_jobs as number | null) ?? 0,
      lead_score: (company.lead_score as number | null) ?? 0,
      starred: Boolean(meta?.starred),
      notes: (meta?.notes as string | null) ?? "",
    } satisfies CoachCompanyRow;
  });
}
