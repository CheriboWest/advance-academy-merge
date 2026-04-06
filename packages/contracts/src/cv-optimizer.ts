import type { AcceptedJobResponse } from './jobs.js'

export interface AnalyzeCvRequest {
  targetRole: string
  currentCvText: string
  jobDescription?: string
}

export interface AnalyzeCvSection {
  title: string
  score: number
  feedback: string
}

export interface KeywordHighlight {
  keyword: string
  foundInCv: boolean
  category: 'required_skill' | 'tech_stack' | 'nice_to_have'
}

export interface BulletEvaluation {
  original: string
  hasImpact: boolean
  impactScore: number  // 1–10
  feedback: string
}

export interface RewriteSuggestion {
  section: string    // e.g. "Experience — Acme Corp"
  current: string
  suggested: string
  reason: string
}

export interface AtsCheck {
  score: number      // 0–100
  issues: string[]
  passed: string[]
}

export interface FormatCheck {
  issues: string[]
  suggestions: string[]
}

export interface JdAlignment {
  matchedRequirements: string[]
  missingRequirements: string[]
  alignmentSummary: string
}

export interface AnalyzeCvResult {
  overallScore: number
  sections: AnalyzeCvSection[]
  expertReview: string
  keywordHighlights: KeywordHighlight[]
  atsCheck: AtsCheck
  formatCheck: FormatCheck
  bulletEvaluations: BulletEvaluation[]
  rewriteSuggestions: RewriteSuggestion[]
  jdAlignment: JdAlignment
}

export type AnalyzeCvAcceptedResponse = AcceptedJobResponse
