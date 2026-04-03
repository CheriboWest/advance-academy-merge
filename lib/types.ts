export type ViewName = 'home' | 'companies' | 'outreach' | 'cv' | 'interview'

export interface NavItem {
  label: string
  view: ViewName
}

export interface CompanyFormData {
  industry: string
  location: string
  companySize: string
}

export interface CompanyResult {
  name: string
  industry: string
  location: string
  match: number
}

export interface OutreachFormData {
  jobTitle: string
  company: string
}

export interface OutreachScript {
  type: string
  content: string
}

export type CvTabName = 'analysis' | 'expert'

export interface CVSection {
  title: string
  score: number
  feedback: string
}

export interface CVReview {
  overallScore: number
  sections: CVSection[]
  expertReview: string
}
