import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  CoachCompanyRow,
  CoachDashboardData,
  CompanySummary,
  OutreachEmail,
  SponsoredCompanyContext,
  SponsoredCompanyRow,
} from "@/lib/types";

const COMPANY_COLUMNS =
  "id, slug, name, website, careers_url, sector, region, hq_location, lead_score, open_jobs";

const HIGH_SCORE_THRESHOLD = 80;

/**
 * Company ids the current coach has removed from their workspace
 * (`coach_company_meta.hidden = true`). RLS restricts these rows to the
 * signed-in coach, so this is inherently per-coach and never affects students,
 * other coaches, or the shared `companies` / `public_company_summary` data.
 */
export async function getHiddenCompanyIds(
  supabase: SupabaseClient
): Promise<string[]> {
  const { data, error } = await supabase
    .from("coach_company_meta")
    .select("company_id")
    .eq("hidden", true);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.company_id as string);
}

/** PostgREST `in` list literal, e.g. `(id1,id2)`. */
function inList(ids: string[]): string {
  return `(${ids.join(",")})`;
}

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

  // Exclude the coach's hidden companies from every aggregate and list. The
  // filter is applied in-query, before any `limit`, so counts and top-N lists
  // reflect only the coach's visible companies.
  const hiddenIds = await getHiddenCompanyIds(supabase);

  let totalQuery = supabase
    .from("public_company_summary")
    .select("*", { count: "exact", head: true });
  let highScoreQuery = supabase
    .from("public_company_summary")
    .select("*", { count: "exact", head: true })
    .gte("lead_score", HIGH_SCORE_THRESHOLD);
  let jobsQuery = supabase.from("public_company_summary").select("id, open_jobs");
  // The view exposes no timestamp column, so we approximate "recent" by id.
  let recentQuery = supabase
    .from("public_company_summary")
    .select(COMPANY_COLUMNS)
    .order("id", { ascending: false })
    .limit(10);
  let topHiringQuery = supabase
    .from("public_company_summary")
    .select(COMPANY_COLUMNS)
    .order("open_jobs", { ascending: false, nullsFirst: false })
    .limit(5);

  if (hiddenIds.length) {
    const notIn = inList(hiddenIds);
    totalQuery = totalQuery.not("id", "in", notIn);
    highScoreQuery = highScoreQuery.not("id", "in", notIn);
    jobsQuery = jobsQuery.not("id", "in", notIn);
    recentQuery = recentQuery.not("id", "in", notIn);
    topHiringQuery = topHiringQuery.not("id", "in", notIn);
  }

  const [
    totalResult,
    highScoreResult,
    jobsResult,
    recentResult,
    topHiringResult,
  ] = await Promise.all([
    totalQuery,
    highScoreQuery,
    jobsQuery,
    recentQuery,
    topHiringQuery,
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
 * Companies for the coach's list, merged with their private metadata (starred +
 * notes). The metadata query is limited to the coach's own rows by RLS.
 *
 * `options.hidden` selects the view:
 *   - `false` (default) → the coach's visible companies (`hidden = false`)
 *   - `true`            → the coach's removed companies (`hidden = true`)
 *
 * Filtering is done server-side against the coach's own meta rows: the meta is
 * read first (cheap, RLS-scoped), then the `public_company_summary` query is
 * narrowed with `id in`/`id not in` so we never pull the full company set to
 * filter in JS.
 */
export async function getCoachCompanies(
  options: { hidden?: boolean } = {}
): Promise<CoachCompanyRow[]> {
  const hidden = options.hidden ?? false;
  const supabase = await createSupabaseServerClient();

  const { data: metaData, error: metaError } = await supabase
    .from("coach_company_meta")
    .select("company_id, starred, notes, hidden");
  if (metaError) throw new Error(metaError.message);

  const metaByCompany = new Map(
    (metaData ?? []).map((meta) => [meta.company_id as string, meta])
  );
  const hiddenIds = (metaData ?? [])
    .filter((meta) => meta.hidden)
    .map((meta) => meta.company_id as string);

  // The "Removed" view is exactly the hidden set — empty if nothing is hidden,
  // so skip the companies query entirely.
  if (hidden && hiddenIds.length === 0) return [];

  let companiesQuery = supabase
    .from("public_company_summary")
    .select("id, slug, name, region, hq_location, open_jobs, lead_score")
    .order("name", { ascending: true });

  if (hidden) {
    companiesQuery = companiesQuery.in("id", hiddenIds);
  } else if (hiddenIds.length) {
    companiesQuery = companiesQuery.not("id", "in", inList(hiddenIds));
  }

  const { data: companiesData, error: companiesError } = await companiesQuery;
  if (companiesError) throw new Error(companiesError.message);

  return (companiesData ?? []).map((company) => {
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

const SPONSORED_COMPANY_COLUMNS =
  "id, slug, name, sector, region, hq_location, open_jobs, lead_score, ai_summary, ai_summary_generated_at";

/**
 * All companies for the Sponsored Companies list. Also the company set the
 * Outreach placeholder's "choose a company" step reuses — see
 * app/coach/(workspace)/outreach/page.tsx — so this stays free of anything
 * Sponsored-Companies-specific (sponsorship status and contact counts are
 * fetched separately and merged in by each page, not baked in here).
 */
export async function getSponsoredCompanies(): Promise<SponsoredCompanyRow[]> {
  const supabase = await createSupabaseServerClient();

  const hiddenIds = await getHiddenCompanyIds(supabase);

  let companiesQuery = supabase
    .from("public_company_summary")
    .select(SPONSORED_COMPANY_COLUMNS)
    .order("name", { ascending: true });
  if (hiddenIds.length) {
    companiesQuery = companiesQuery.not("id", "in", inList(hiddenIds));
  }

  const { data, error } = await companiesQuery;
  if (error) throw new Error(error.message);

  return (data ?? []).map((company) => ({
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
  }));
}

/** Company context for the Sponsored Company detail page's overview, by id. */
export async function getSponsoredCompanyContext(
  companyId: string
): Promise<SponsoredCompanyContext | null> {
  const supabase = await createSupabaseServerClient();

  // A company the coach has removed is treated as not found in their workspace.
  const hiddenIds = await getHiddenCompanyIds(supabase);
  if (hiddenIds.includes(companyId)) return null;

  const { data, error } = await supabase
    .from("public_company_summary")
    .select(SPONSORED_COMPANY_COLUMNS)
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
    ai_summary: (data.ai_summary as string | null) ?? null,
    ai_summary_generated_at:
      (data.ai_summary_generated_at as string | null) ?? null,
  };
}

/**
 * Company names by id, for the Outreach activity dashboard — one row per
 * outreach attempt needs the company name next to it, without pulling the
 * full company summary shape.
 */
export async function getCompanyNames(
  companyIds: string[]
): Promise<Record<string, string>> {
  if (companyIds.length === 0) return {};
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("public_company_summary")
    .select("id, name")
    .in("id", companyIds);
  if (error) throw new Error(error.message);

  const names: Record<string, string> = {};
  for (const row of data ?? []) {
    names[row.id as string] = row.name as string;
  }
  return names;
}

/**
 * The current coach's own private notes about a company (from
 * `coach_company_meta`, RLS-scoped), for the Outreach research panel —
 * reuses the exact same notes shown/edited via NotesDialog on
 * /coach/companies, not a separate copy. `null` if the coach never wrote any.
 */
export async function getCompanyNotes(companyId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("coach_company_meta")
    .select("notes")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const notes = (data?.notes as string | null | undefined)?.trim();
  return notes || null;
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
