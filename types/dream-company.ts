export interface DreamCompanyInput {
  degree: string
  workExperience: string
  skills: string
  interests: string
  targetSalary: string
  location: string
}

export interface ProfileAnalysis {
  marketLevel: 'entry' | 'junior' | 'mid' | 'senior' | 'lead' | 'executive'
  marketLevelRationale: string
  salaryRange: { min: number; max: number; currency: string; note: string }
  coreStrengths: { strength: string; evidence: string }[]
  criticalGaps: { gap: string; impact: string; urgency: 'high' | 'medium' | 'low' }[]
  uniqueValueProposition: string
  readinessScore: number
  readinessNote: string
}

export interface Company {
  name: string
  industry: string
  why: string
  likelyRole: string
  challenge: string
  hiringSignal: string
  tier: 1 | 2 | 3
}

export interface CompanyMatrix {
  tier1: { label: string; description: string; companies: Company[] }
  tier2: { label: string; description: string; companies: Company[] }
  tier3: { label: string; description: string; companies: Company[] }
}

export interface TargetRole {
  title: string
  level: string
  fitScore: number
  fitReason: string
  demandLevel: 'high' | 'medium' | 'low'
  avgSalary: string
}

export interface RoadmapPhase {
  phase: number
  duration: string
  goal: string
  actions: string[]
  skills: string[]
  milestone: string
}

export interface CareerRoadmap {
  phases: RoadmapPhase[]
}

export interface DreamCompanyResult {
  profile: DreamCompanyInput
  analysis: ProfileAnalysis
  matrix: CompanyMatrix
  roles: TargetRole[]
  roadmap: CareerRoadmap
  generatedAt: Date
}
