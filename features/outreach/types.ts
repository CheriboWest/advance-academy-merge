import type {
  EnrichmentCard,
  EnrichmentResponse,
  ExperienceLevel,
  OutreachIntent,
  OutreachOutputs,
} from '@/types/outreach'

export type {
  OutreachIntent,
  ExperienceLevel,
  OutreachOutputs,
  EnrichmentCard,
  EnrichmentResponse,
} from '@/types/outreach'

export interface OutreachFormData {
  cvText: string
  portfolioUrl: string
  portfolioText: string
  targetCompany: string
  targetPersonName: string
  targetRole: string
  experienceLevel: ExperienceLevel
  intent: OutreachIntent
  selectedHiringCard: EnrichmentCard | null
  selectedSocialCard: EnrichmentCard | null
  outputs: OutreachOutputs
  enrichmentResults: EnrichmentResponse | null
}
