import type { Contactability } from './leads.js'

/**
 * One person, seen from the admin side.
 *
 * A lead and an account are the same human at two points in a funnel, but they
 * live in different tables with different consent rules (see leads.ts). This
 * profile joins them for reading without merging them for storage: either half
 * can be null, and the screen says which halves it found.
 *
 * The point of the whole shape is the `activity` block. /admin/users could
 * previously answer "has this person ever used a tool" with a tick and nothing
 * more, which is not enough to decide whether someone is worth a coach's hour.
 */

export type PersonEventKind = 'tool' | 'interview' | 'coaching'

export interface PersonEvent {
  /** ISO timestamp. The list is sorted by this, newest first. */
  at: string
  kind: PersonEventKind
  /** e.g. 'cv', 'dream', 'interview' for tools; the session status otherwise. */
  detail: string
  /** One line fit for a list row, e.g. 'Data Analyst · against a JD'. */
  label: string
}

export interface PersonActivity {
  /** Newest event of any kind, or null if they have never done anything. */
  lastActiveAt: string | null
  firstActiveAt: string | null
  totalEvents: number
  /** Events in the 30 days before the moment the profile was read. */
  events30d: number
  /** Count per tool, e.g. { cv: 3, interview: 1 }. Absent tools are omitted. */
  byTool: Record<string, number>
  /** Newest first, capped — the full history is not what this screen is for. */
  timeline: PersonEvent[]
}

export interface PersonAccount {
  userId: string
  status: string
  tier: string
  isAdmin: boolean
  credits: number
  /** Null means unlimited (admins) — same convention as /api/account/me. */
  coachingCredits: number | null
  referralCount: number
  joinedAt: string
  reviewedAt: string | null
  firstToolUsedAt: string | null
}

export interface PersonLead {
  leadId: string
  source: string
  leadMagnetId: string | null
  capturedAt: string
  whatsapp: string | null
  whatsappDigits: string | null
  house: string | null
  scoreBreakdown: string | null
  contactable: Contactability
  contactReason: string
  consentMarketing: boolean
  consentTs: string | null
  doubleOptin: boolean
  status: string
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
}

export interface PersonAdminAction {
  at: string
  action: string
  detail: Record<string, unknown>
}

export interface AdminPersonProfile {
  email: string
  name: string | null
  account: PersonAccount | null
  lead: PersonLead | null
  activity: PersonActivity
  /** Who changed what on this account, newest first. Empty for a pure lead. */
  adminTrail: PersonAdminAction[]
}
