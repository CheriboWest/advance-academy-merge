export type ViewName =
  | 'home'
  | 'companies'
  | 'outreach'
  | 'cv'
  | 'interview'
  | 'history'

export interface NavItem {
  label: string
  view: ViewName
  href?: string
}
