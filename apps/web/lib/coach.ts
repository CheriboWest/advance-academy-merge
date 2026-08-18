import type { User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  CoachCompanyRow,
  CoachDashboardData,
  CompanySummary,
  OutreachCompany,
  OutreachCompanyContext,
  OutreachEmail,
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
    supabase
      .from("coach_company_meta")
      .select("company_id, starred, notes, hidden"),
  ]);

  if (companiesResult.error) throw new Error(companiesResult.error.message);
  if (metaResult.error) throw new Error(metaResult.error.message);

  const metaByCompany = new Map(
    (metaResult.data ?? []).map((meta) => [meta.company_id as string, meta])
  );

  return (companiesResult.data ?? [])
    // Drop companies the coach has removed from their own list.
    .filter((company) => !metaByCompany.get(company.id as string)?.hidden)
    .map((company) => {
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

const OUTREACH_COMPANY_COLUMNS =
  "id, slug, name, sector, region, hq_location, open_jobs, lead_score";

/**
 * All companies for the outreach list, flagged with whether the current coach
 * already has a saved draft. The drafts query is limited to the coach's own
 * rows (explicit filter plus RLS).
 */
export async function getOutreachCompanies(): Promise<OutreachCompany[]> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [companiesResult, draftsResult] = await Promise.all([
    supabase
      .from("public_company_summary")
      .select(OUTREACH_COMPANY_COLUMNS)
      .order("name", { ascending: true }),
    user
      ? supabase
          .from("outreach_emails")
          .select("company_id")
          .eq("coach_user_id", user.id)
          .eq("status", "draft")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (companiesResult.error) throw new Error(companiesResult.error.message);
  if (draftsResult.error) throw new Error(draftsResult.error.message);

  const draftCompanyIds = new Set(
    (draftsResult.data ?? []).map((row) => row.company_id as string)
  );

  return (companiesResult.data ?? []).map((company) => ({
    company_id: company.id as string,
    slug: company.slug as string,
    name: company.name as string,
    location:
      (company.hq_location as string | null) ??
      (company.region as string | null) ??
      "—",
    sector: (company.sector as string | null) ?? null,
    open_jobs: (company.open_jobs as number | null) ?? 0,
    lead_score: (company.lead_score as number | null) ?? 0,
    hasDraft: draftCompanyIds.has(company.id as string),
  }));
}

/** Company context for the composer page, by company id. */
export async function getCompanyContext(
  companyId: string
): Promise<OutreachCompanyContext | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("public_company_summary")
    .select(OUTREACH_COMPANY_COLUMNS)
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    company_id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
    location:
      (data.hq_location as string | null) ??
      (data.region as string | null) ??
      "—",
    sector: (data.sector as string | null) ?? null,
    open_jobs: (data.open_jobs as number | null) ?? 0,
    lead_score: (data.lead_score as number | null) ?? 0,
  };
}

/** The current coach's existing draft for a company, or `null`. */
export async function getExistingDraft(
  companyId: string
): Promise<OutreachEmail | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("outreach_emails")
    .select("*")
    .eq("coach_user_id", user.id)
    .eq("company_id", companyId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as OutreachEmail | null) ?? null;
}
