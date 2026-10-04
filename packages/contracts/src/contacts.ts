/**
 * Company contacts — one `public.contacts` table (migration 034), two surfaces:
 * coaches manage them in Career Hub (via backend-python), students on
 * Membership see a reduced shape on the public company page (via Fastify).
 *
 * The category is derived from the free-text `job_title` rather than stored, so
 * coach entry and the spreadsheet import stay one field and nothing needs a
 * migration or a backfill.
 */

export type ContactCategory = 'hr' | 'recruiter' | 'hiring_manager' | 'department_head' | 'leadership' | 'other'

/** Display order and labels, most useful-to-a-student first. */
export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  hr: 'HR / People',
  recruiter: 'Recruiters / Talent',
  hiring_manager: 'Hiring managers',
  department_head: 'Department heads',
  leadership: 'Founders / Directors',
  other: 'Other contacts',
}

export const CONTACT_CATEGORY_ORDER = Object.keys(CONTACT_CATEGORY_LABELS) as ContactCategory[]

// First match wins: function-specific rules run before seniority, so "Head of
// Talent" is a recruiter and "HR Business Partner" is HR, not leadership.
const RULES: Array<[ContactCategory, RegExp]> = [
  ['recruiter', /recruit|talent|sourcing|sourcer/i],
  ['hr', /\bhr\b|hrbp|human resources|\bpeople\b|personnel/i],
  ['leadership', /founder|owner|\bceo\b|\bcoo\b|\bcto\b|\bcfo\b|managing director|\bmd\b|president|chair|\bpartner\b/i],
  ['department_head', /head of|director|\bvp\b|vice president|chief/i],
  ['hiring_manager', /manager|\blead\b|supervisor/i],
]

export function contactCategory(jobTitle: string | null | undefined): ContactCategory {
  const title = jobTitle?.trim() ?? ''
  return RULES.find(([, pattern]) => pattern.test(title))?.[0] ?? 'other'
}

/** GET /api/public/company-contacts/:companyId/summary — no personal data, so public. */
export interface CompanyContactSummary {
  total: number
  byCategory: Partial<Record<ContactCategory, number>>
}

/**
 * GET /api/company-contacts/:companyId — Membership only (403 MEMBERSHIP_REQUIRED
 * otherwise). Deliberately no phone or notes: those stay in coach tooling.
 */
export interface CompanyContact {
  id: string
  full_name: string
  job_title: string | null
  category: ContactCategory
  email: string | null
  linkedin_url: string | null
}
