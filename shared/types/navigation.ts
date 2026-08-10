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
 * built. Eight flat entries in a top bar is a wall of text; three named stages
 * of six tools is something a student can scan.
 */
export interface NavGroup {
  label: string
  items: NavItem[]
}
