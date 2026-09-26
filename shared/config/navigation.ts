import {
  Bookmark,
  Brain,
  Briefcase,
  FileSignature,
  FileText,
  GraduationCap,
  Library,
  Search,
  Target,
} from 'lucide-react'
import type { NavGroup, NavItem, ViewName } from '@/shared/types/navigation'

/**
 * The single source of truth for the tool taxonomy. The top-bar menu and the
 * home page both render from this, so the two can't drift into describing the
 * same tool differently — which is how the home page ended up advertising four
 * tools while the bar listed eight.
 *
 * Groups follow the App 1 map: Find Jobs → Applications → Career Tools. Items
 * with `href` live on their own route; the rest are `/?view=`.
 */
export const TOOL_GROUPS: NavGroup[] = [
  {
    label: 'Find jobs',
    items: [
      {
        label: 'Job Search',
        view: 'search',
        href: '/search',
        icon: Search,
        description: 'UK employers that are hiring now, with their open roles.',
      },
      {
        label: 'Dream Company',
        view: 'companies',
        icon: Briefcase,
        description: 'Companies that match your goals, industry and location.',
      },
    ],
  },
  {
    label: 'Applications',
    items: [
      {
        label: 'Job Tracker',
        view: 'jobs',
        href: '/jobs',
        icon: Bookmark,
        description: 'Every job you are chasing, from saved to offer.',
      },
      {
        label: 'Cover Letter',
        view: 'cover-letter',
        href: '/cover-letter',
        icon: FileSignature,
        description: 'A letter tailored to one job, written from your CV.',
      },
    ],
  },
  {
    label: 'Career tools',
    items: [
      {
        label: 'CV Optimizer',
        view: 'cv',
        icon: FileText,
        description: 'Expert feedback on structure, content and impact.',
      },
      {
        label: 'CV Library',
        view: 'cv-library',
        icon: Library,
        description: 'Your bullet points, evidence and the gaps still to fill.',
      },
      {
        label: 'Interview Prep',
        view: 'interview',
        icon: Brain,
        description: 'Practise behavioural and technical questions, and get scored.',
      },
      {
        label: 'Outreach',
        view: 'outreach',
        icon: Target,
        description: 'Personalised LinkedIn, email and phone scripts for recruiters.',
      },
      {
        label: 'Coaching',
        view: 'coaching',
        icon: GraduationCap,
        description: 'Book an hour with a coach and get a prep pack for it.',
      },
    ],
  },
]

/** Flat list, for anything that needs to look a tool up by view. */
export const TOOL_ITEMS: NavItem[] = TOOL_GROUPS.flatMap((group) => group.items)

export function findToolItem(view: ViewName): NavItem | undefined {
  return TOOL_ITEMS.find((item) => item.view === view)
}
