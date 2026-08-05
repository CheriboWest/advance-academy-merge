// Candidate Acquisition — admin lead-list types (CA-001, Bước 6).
// Mirrors the backend `LeadRow` shape returned by GET /api/leads.

export interface LeadRow {
  id: string
  email: string
  name: string | null
  source: string
  utm_source: string | null
  readiness_score: number | null
  consent_marketing: boolean
  double_optin: boolean
  status: string
  created_at: string
  /** True when an account exists with this email — i.e. the lead converted. */
  has_account: boolean
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
