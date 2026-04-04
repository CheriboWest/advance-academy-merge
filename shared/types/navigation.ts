export type ViewName = 'home' | 'companies' | 'outreach' | 'cv' | 'interview'

export interface NavItem {
  label: string
  view: ViewName
}
