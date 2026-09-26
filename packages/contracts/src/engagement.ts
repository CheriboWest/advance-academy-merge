/**
 * Progress & Engagement (App 1): a fixed set of weekly tasks, points for
 * finishing them, and a reminder email when they are still open late in the
 * week (migration 045).
 *
 * Tasks are defined here, once, and ticked off from what the student actually
 * did — job_events, tool_results, saved_jobs — never by a checkbox. Points are
 * a score, not a currency: they are unrelated to the credit wallet and can't be
 * spent or exchanged.
 */

/** What a task counts, within one week. */
export type EngagementMetric = 'applications' | 'jobs_saved' | 'cv_runs' | 'cover_letters' | 'interviews'

export interface EngagementTaskDef {
  key: string
  title: string
  metric: EngagementMetric
  target: number
  points: number
  /** Where to go to make progress on it. */
  href: string
}

export const ENGAGEMENT_TASKS: readonly EngagementTaskDef[] = [
  { key: 'apply_10', title: 'Make 10 quality applications', metric: 'applications', target: 10, points: 50, href: '/jobs' },
  { key: 'save_5', title: 'Save 5 jobs worth applying for', metric: 'jobs_saved', target: 5, points: 10, href: '/search' },
  { key: 'tailor_cv', title: 'Tailor your CV to a job', metric: 'cv_runs', target: 1, points: 20, href: '/cv-optimizer' },
  { key: 'cover_letter', title: 'Write a tailored cover letter', metric: 'cover_letters', target: 1, points: 15, href: '/cover-letter' },
  { key: 'mock_interview', title: 'Do a mock interview', metric: 'interviews', target: 1, points: 20, href: '/?view=interview' },
]

export interface EngagementTask extends EngagementTaskDef {
  /** Count so far this week, capped at `target`. */
  progress: number
  done: boolean
}

/** GET /api/engagement */
export interface EngagementResponse {
  /** Monday the current week started (UTC), `YYYY-MM-DD`. */
  weekStart: string
  tasks: EngagementTask[]
  pointsThisWeek: number
  pointsTotal: number
  emailReminders: boolean
}

/** PATCH /api/engagement */
export interface UpdateEngagementSettingsRequest {
  emailReminders: boolean
}
