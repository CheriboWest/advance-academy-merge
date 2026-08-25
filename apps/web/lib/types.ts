/**
 * Domain types for the public student portal, mapped to the Supabase schema.
 *
 * `CompanySummary` mirrors the `public_company_summary` SQL view (snake_case,
 * exactly as returned by PostgREST). `Job` mirrors the `jobs` table.
 */

/** A row from the `public_company_summary` view. */
export interface CompanySummary {
  id: string;
  slug: string;
  name: string;
  website: string | null;
  careers_url: string | null;
  sector: string | null;
  region: string | null;
  hq_location: string | null;
  lead_score: number | null;
  open_jobs: number | null;
}

/**
 * A company returned by Job Role Search: a company summary plus the number of
 * that company's active jobs whose title matched the searched role. Kept
 * conceptually separate from `open_jobs` (total active jobs).
 */
export interface CompanyRoleResult extends CompanySummary {
  matching_jobs: number;
}

/** A row from the `jobs` table. */
export interface Job {
  id: string;
  company_id: string;
  title: string;
  location_raw: string | null;
  city: string | null;
  salary_min: number | null;
  salary_max: number | null;
  posted_at: string | null;
  is_active: boolean;
  /** Optional outbound link to the live posting, if the row provides one. */
  source_url?: string | null;
}

/**
 * A row from the `coach_company_meta` table — private, per-coach metadata for a
 * company. Protected by RLS keyed to `coach_user_id = auth.uid()`.
 */
export interface CoachCompanyMeta {
  coach_user_id: string;
  company_id: string;
  starred: boolean;
  hidden: boolean;
  notes: string | null;
}

/** A company summary merged with the current coach's private metadata. */
export interface CoachCompanyRow {
  company_id: string;
  slug: string;
  name: string;
  location: string;
  open_jobs: number;
  lead_score: number;
  starred: boolean;
  notes: string;
}

/** A company shown in the Sponsored Companies list. */
export interface SponsoredCompanyRow {
  company_id: string;
  slug: string;
  name: string;
  location: string;
  sector: string | null;
  open_jobs: number;
  lead_score: number;
}

/** Company context shown on the Sponsored Company detail page's overview. */
export interface SponsoredCompanyContext {
  company_id: string;
  slug: string;
  name: string;
  location: string;
  sector: string | null;
  open_jobs: number;
  lead_score: number;
}

/**
 * The coach-facing sponsorship status for one company, from
 * GET /sponsors/companies/{id}. One of five normalized states; see
 * apps/api/app/schemas.py CompanySponsorshipStatus for the full contract
 * (in particular why `licensed` needs no `stale` check while the others do).
 */
export type SponsorshipStatus =
  | "licensed"
  | "ambiguous"
  | "no_match"
  | "error"
  | "not_checked";

export interface SponsorshipMatch {
  organisation_name: string;
  town_city: string | null;
  county: string | null;
  type_rating: string | null;
  licence_type: string | null;
  rating: string | null;
  routes: string[];
  confidence: number;
}

export interface CompanySponsorshipStatus {
  company_id: string;
  status: SponsorshipStatus;
  checked_at: string | null;
  register_import_id: string | null;
  candidate_count: number | null;
  stale: boolean;
  match: SponsorshipMatch | null;
}

/**
 * The list-badge shape from POST /sponsors/companies/statuses — enough to
 * render a compact status chip. Deliberately not the full
 * CompanySponsorshipStatus: no organisation name, routes, confidence, or
 * error text on a page that shows many companies at once.
 */
export interface CompanySponsorshipStatusCompact {
  status: SponsorshipStatus;
  stale: boolean;
  checked_at: string | null;
}

/**
 * A company contact, from the FastAPI `/contacts` endpoints — never a direct
 * Supabase read. The `contacts` table is deny-by-default RLS,
 * service-role-only (same posture as sponsorship data): the backend is the
 * only thing allowed to query it, which is also what keeps contacts off any
 * public/student-facing page by construction.
 */
export interface Contact {
  id: string;
  company_id: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Body for creating/editing a contact — see ContactWrite in schemas.py. */
export interface ContactInput {
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
}

/** Aggregated data for the coach dashboard. */
export interface CoachDashboardData {
  totalCompanies: number;
  highScoreCompanies: number;
  totalActiveJobs: number;
  recentCompanies: CompanySummary[];
  topHiringCompanies: CompanySummary[];
}
