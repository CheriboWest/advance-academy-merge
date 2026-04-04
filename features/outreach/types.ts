export interface ExperienceEntry {
  title: string
  company: string
  description: string
  duration: string
}

export interface OutreachFormData {
  // LinkedIn Profile
  headline: string
  about: string
  experience: ExperienceEntry[]
  skills: string[]
  posts: string[]

  // Target Data
  targetName: string
  targetRole: string
  targetCompany: string
  targetIndustry: string
  recentActivity: string
  whyThisCompany: string
  companySignal: string
  hiringManager: string
  hiringManagerRole: string

  // Role Data
  roleTitle: string
  department: string
  keyRequirements: string[]
  impliedPain: string

  // Recruiter Data
  recruiterName: string
  recruiterType: 'agency' | 'in-house'
  specialization: string
  activeRoles: string[]

  // Desired Role
  desiredTitle: string
  desiredLocation: string
  salaryExpectation: string
}

export interface OutreachScript {
  type: string
  content: string
}
