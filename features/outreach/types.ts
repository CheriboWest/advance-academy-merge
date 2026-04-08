import type {
  EnrichmentCard,
  EnrichmentResponse,
  ExperienceLevel,
  ManualContext,
  OutreachIntent,
  OutreachOutputs,
} from '@/types/outreach'

export type {
  OutreachIntent,
  ExperienceLevel,
  OutreachOutputs,
  EnrichmentCard,
  EnrichmentResponse,
  ManualContext,
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
  experienceLevel: ExperienceLevel
  intent: OutreachIntent
  manualContexts: ManualContextLink[]
  selectedHiringCard: EnrichmentCard | null
  selectedSocialCard: EnrichmentCard | null
  outputs: OutreachOutputs
  enrichmentResults: EnrichmentResponse | null
}
