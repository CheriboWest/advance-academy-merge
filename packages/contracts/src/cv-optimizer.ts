import type { AcceptedJobResponse } from './jobs.js'

export interface AnalyzeCvRequest {
  candidateName: string
  targetRole: string
  currentCvText: string
  jobDescription?: string
}

export interface AnalyzeCvSection {
  title: string
  score: number
  feedback: string
}

export interface AnalyzeCvResult {
  overallScore: number
  sections: AnalyzeCvSection[]
  expertReview: string
}

export type AnalyzeCvAcceptedResponse = AcceptedJobResponse
