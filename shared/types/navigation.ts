export type ViewName =
  | 'home'
  | 'companies'
  | 'outreach'
  | 'cv'
  | 'interview'
  | 'cv-library'
  | 'history'

export interface NavItem {
  label: string
  view: ViewName
  href?: string
}
