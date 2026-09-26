import type { LucideIcon } from 'lucide-react'

export type ViewName =
  | 'home'
  | 'companies'
  | 'outreach'
  | 'cv'
  | 'interview'
  | 'cv-library'
  | 'coaching'
  | 'history'
  | 'jobs'
  | 'search'
  | 'cover-letter'

export interface NavItem {
  label: string
  view: ViewName
  /** One line, sentence case. Shown in the Tools menu and on the home cards. */
  description: string
  icon: LucideIcon
  /** Set for destinations that live on their own route rather than `/?view=`. */
  href?: string
}

/**
 * Tools are grouped by where they sit in a job search, not by when they were
 * built: find a job, apply for it, sharpen the tools you apply with. Three
 * named stages is something a student can scan; a flat list is not.
 */
export interface NavGroup {
  label: string
  items: NavItem[]
}
