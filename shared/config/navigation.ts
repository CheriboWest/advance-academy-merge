import type { NavItem } from '@/shared/types/navigation'

export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', view: 'home' },
  { label: 'Dream Company', view: 'companies', href: '/dream-company' },
  { label: 'Outreach', view: 'outreach' },
  { label: 'CV Optimizer', view: 'cv', href: '/cv-optimizer' },
  { label: 'Interview Prep', view: 'interview' },
]
