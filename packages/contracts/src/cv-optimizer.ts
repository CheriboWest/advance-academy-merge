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

export type AtsKeywordCategory =
  | 'job_title'
  | 'tool_or_technical_skill'
  | 'hard_skill'
  | 'industry_term'
  | 'certification'
  | 'seniority_indicator'
  | 'mandatory_requirement'

export interface AtsExtractedKeyword {
  keyword: string
  category: AtsKeywordCategory
  mandatory: boolean          // true for must-have items (licence, visa, DBS, degree, etc.)
  foundInCv: boolean
}

export interface AtsRelevanceSignal {
  signal: string              // e.g. "job_history_relevance"
  score: number               // 1–10
  reasoning: string
}

export interface AtsCheck {
  score: number      // 0–100
  issues: string[]
  passed: string[]
  extractedKeywords: AtsExtractedKeyword[]
  relevanceSignals: AtsRelevanceSignal[]
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

export interface ActionPlanItem {
  title: string
  description: string
}

export interface ActionPlan {
  summary: string
  projectsToBuild: ActionPlanItem[]
  skillsToLearn: ActionPlanItem[]
  certifications: ActionPlanItem[]
  intermediateRoles: ActionPlanItem[]
}

/**
 * Composite score breakdown:
 *   overallScore = 0.25 × cvOverview + 0.40 × atsAndKeywordIntelligence + 0.35 × bulletImpact
 */
export interface ScoreBreakdown {
  cvOverview: number               // 0–100  (weight 25%)
  atsAndKeywordIntelligence: number // 0–100  (weight 40%)
  bulletImpact: number             // 0–100  (weight 35%)
}

export interface AnalyzeCvResult {
  overallScore: number
  scoreBreakdown: ScoreBreakdown
  sections: AnalyzeCvSection[]
  keywordHighlights: KeywordHighlight[]
  atsCheck: AtsCheck
  formatCheck: FormatCheck
  bulletEvaluations: BulletEvaluation[]
  rewriteSuggestions: RewriteSuggestion[]
  jdAlignment: JdAlignment
  actionPlan: ActionPlan
}

export type AnalyzeCvAcceptedResponse = AcceptedJobResponse
