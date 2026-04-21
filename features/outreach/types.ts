export type {
  OutreachIntent,
  ExperienceLevel,
  OutreachOutputs,
  EnrichmentCard,
  EnrichmentResponse,
  ManualContext,
  InsightSignal,
  JdValidationResult,
} from '@/types/outreach'

export type ManualContextStatus = 'idle' | 'loading' | 'success' | 'error'

export interface ManualContextLink {
  id: string
  title: string
  url: string
  status: ManualContextStatus
  extractedText: string
  errorMessage?: string
}

export interface OutreachFormData {
  cvText: string
  portfolioUrl: string
  portfolioText: string
  targetCompany: string
  targetCountry: string
  targetPersonName: string
  targetRole: string
  experienceLevel: import('@/types/outreach').ExperienceLevel
  intent: import('@/types/outreach').OutreachIntent
  userLocation: string
  jdText: string
  jdUrl: string
  jdValidating: boolean
  jdValidationError: string
  manualContexts: ManualContextLink[]
  selectedInsightCards: import('@/types/outreach').EnrichmentCard[]
  outputs: import('@/types/outreach').OutreachOutputs
  enrichmentResults: import('@/types/outreach').EnrichmentResponse | null
}
