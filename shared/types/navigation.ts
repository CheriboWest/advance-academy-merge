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
  href?: string
}
