import { Brain, Briefcase, FileText, GraduationCap, Library, Target } from 'lucide-react'
import type { NavGroup, NavItem, ViewName } from '@/shared/types/navigation'

/**
 * The single source of truth for the tool taxonomy. The top-bar menu and the
 * home page both render from this, so the two can't drift into describing the
 * same tool differently — which is how the home page ended up advertising four
 * tools while the bar listed eight.
 */
export const TOOL_GROUPS: NavGroup[] = [
  {
    label: 'Find opportunities',
    items: [
      {
        label: 'Dream Company',
        view: 'companies',
        icon: Briefcase,
        description: 'Companies that match your goals, industry and location.',
      },
      {
        label: 'Outreach',
        view: 'outreach',
        icon: Target,
        description: 'Personalised LinkedIn, email and phone scripts for recruiters.',
      },
    ],
  },
  {
    label: 'Build your CV',
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
    ],
  },
  {
    label: 'Prepare for interviews',
    items: [
      {
        label: 'Interview Prep',
        view: 'interview',
        icon: Brain,
        description: 'Practise behavioural and technical questions, and get scored.',
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
