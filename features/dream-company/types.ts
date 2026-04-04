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
