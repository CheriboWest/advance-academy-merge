/**
 * Candidate-acquisition lead shapes shared by the Fastify admin routes and the
 * /admin/leads screen.
 *
 * The quiz that feeds these rows lives in a separate repo
 * (advance-academy-quiz). It posts to POST /api/leads/capture with a `result`
 * payload of `{ house, scoreBreakdown, whatsapp }`, which lands in the
 * `candidate_leads.result` jsonb column. Nothing about that payload is enforced
 * by this codebase, so it is read defensively — see readQuizResult() in the
 * backend.
 */

/**
 * The five career archetypes the quiz assigns.
 *
 * Duplicated from the quiz repo's `src/lib/houses.ts` on purpose: the two
 * services deploy independently and a shared package across repos would couple
 * their release cycles. An unknown code must therefore render as itself rather
 * than as an error — see houseLabel().
 */
export const QUIZ_HOUSES: Record<string, string> = {
  SG: 'Strategist Guild',
  AO: 'Analytical Order',
  CC: 'Connector Circle',
  EA: 'Execution Alliance',
  PL: 'Pioneer League',
}

/** Readable archetype name, falling back to the raw code the quiz sent. */
export function houseLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return QUIZ_HOUSES[code] ?? code
}

/**
 * Whether this lead may lawfully be emailed marketing, and why.
 *
 * Not a boolean: "we never asked" and "they asked us to stop" are the same
 * answer with very different consequences, and "opted in but we can't prove
 * they own the inbox" is a third state that should neither be mailed blind nor
 * written off.
 */
export type Contactability = 'yes' | 'no' | 'pending'

export interface LeadRow {
  id: string
  email: string
  name: string | null
  source: string
  lead_magnet_id: string | null

  /** Phone number as the person typed it — this is what you read out loud. */
  whatsapp: string | null
  /** The same number reduced to digits, for a wa.me link. Null if unusable. */
  whatsapp_digits: string | null
  /** Raw archetype code from the quiz, e.g. 'AO'. Use houseLabel() to display. */
  house: string | null
  score_breakdown: string | null

  readiness_score: number | null
  consent_marketing: boolean
  consent_ts: string | null
  double_optin: boolean
  /** Derived verdict — the reason is a short sentence fit for the UI. */
  contactable: Contactability
  contact_reason: string

  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null

  status: string
  created_at: string
  /** True when an account exists with this email — i.e. the lead converted. */
  has_account: boolean
}

/**
 * CSV export, defined once.
 *
 * There are two download paths — the button on /admin/leads builds the file in
 * the browser, and `GET /api/leads?format=csv` builds it on the server — and
 * they used to be two separate hand-written column lists. They drifted from the
 * table they exported, which is how a spreadsheet that was meant to drive
 * outreach ended up with the email column and little else usable.
 *
 * Column order is chosen for someone opening this in Excel to contact people:
 * who they are and how to reach them first, funnel bookkeeping after.
 */
export const CSV_COLUMNS: { key: keyof LeadRow; header: string }[] = [
  { key: 'email', header: 'email' },
  { key: 'name', header: 'name' },
  { key: 'whatsapp', header: 'whatsapp' },
  { key: 'house', header: 'house_code' },
  { key: 'score_breakdown', header: 'score_breakdown' },
  { key: 'contactable', header: 'contactable' },
  { key: 'contact_reason', header: 'contact_reason' },
  { key: 'has_account', header: 'has_account' },
  { key: 'status', header: 'status' },
  { key: 'source', header: 'source' },
  { key: 'lead_magnet_id', header: 'lead_magnet_id' },
  { key: 'utm_source', header: 'utm_source' },
  { key: 'utm_medium', header: 'utm_medium' },
  { key: 'utm_campaign', header: 'utm_campaign' },
  { key: 'consent_marketing', header: 'consent_marketing' },
  { key: 'consent_ts', header: 'consent_ts' },
  { key: 'double_optin', header: 'double_optin' },
  { key: 'readiness_score', header: 'readiness_score' },
  { key: 'created_at', header: 'created_at' },
  { key: 'id', header: 'id' },
]

export const CSV_HEADER = CSV_COLUMNS.map((c) => c.header).join(',')

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  // A leading =, +, - or @ makes Excel and Sheets evaluate the cell as a
  // formula. These are user-supplied strings, so prefix such a value with a
  // quote to keep it inert (CSV injection). This also catches phone numbers
  // written as "+44…" — the quote is the price of not letting a lead's `name`
  // field run a formula on the machine of whoever opens the export.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsvLine(row: LeadRow): string {
  return CSV_COLUMNS.map((c) => csvCell(row[c.key])).join(',')
}

export function leadsToCsv(rows: LeadRow[]): string {
  return [CSV_HEADER, ...rows.map(toCsvLine)].join('\n')
}

export interface LeadsListResponse {
  leads: LeadRow[]
  count: number
}

export interface LeadsFilters {
  status?: string
  source?: string
  utmSource?: string
  limit?: number
}
