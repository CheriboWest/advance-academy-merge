export type ViewName =
  | 'home'
  | 'companies'
  | 'outreach'
  | 'cv'
  | 'interview'
  | 'history'

export interface SessionListItem {
  id: string
  persona_id: string
  mode: string
  status: string
  started_at: string
  ended_at: string | null
  final_score_json: {
    integrity?: number
    relevance?: number
    substance?: number
    overall?: number
  } | null
  context_json: {
    jobTitle?: string
    companyName?: string
  } | null
}

export interface SessionDetail extends SessionListItem {
  user_id: string | null
  candidate_profile_id: string | null
  job_target_id: string | null
  interview_pack_id: string | null
  final_report_json: {
    summary?: string
    strengths?: FeedbackItem[]
    improvements?: FeedbackItem[]
    generatedAt?: number
  } | null
  created_at: string
}

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

// ─────────────────────────────────────────────────────────────
// Interview feature
// ─────────────────────────────────────────────────────────────

export type InterviewStep = 'setup' | 'persona' | 'interview' | 'report'

export type PersonaId =
  | 'skeptic'
  | 'mentor'
  | 'executive'
  | 'technical'
  | 'culture'

export interface InterviewerPersona {
  id: PersonaId
  name: string
  title: string
  description: string
  style: string
  avatar: string
  systemPrompt: string
}

export interface InterviewContext {
  cvText: string
  jobTitle: string
  jobDescription: string
  companyName: string
  companyUrl: string
  extraLinks: string
}

export interface IRSScorePart {
  score: number
  rationale: string
}

export interface IRSScore {
  integrity: IRSScorePart
  relevance: IRSScorePart
  substance: IRSScorePart
  overall: number
}

export interface InterviewMessage {
  id: string
  role: 'interviewer' | 'candidate'
  content: string
  timestamp: number
  irsScore?: IRSScore
}

export interface FeedbackItem {
  title: string
  detail: string
}

export interface FeedbackReport {
  sessionId: string
  overallIRS: IRSScore
  strengths: FeedbackItem[]
  improvements: FeedbackItem[]
  summary: string
  generatedAt: number
}

export interface InterviewSession {
  id: string
  personaId: PersonaId
  status: 'active' | 'evaluating' | 'complete'
  startedAt: number
  endedAt?: number
  messages: InterviewMessage[]
  context: InterviewContext
  finalReport?: FeedbackReport
}

// API DTOs

export interface StartSessionRequest {
  personaId: PersonaId
  context: InterviewContext
}

export interface StartSessionResponse {
  sessionId: string
  openingQuestion: string
}

export interface SendMessageRequest {
  sessionId: string
  content: string
  messageHistory: Array<{ role: 'interviewer' | 'candidate'; content: string }>
  personaId: PersonaId
  context: InterviewContext
}

export interface SendMessageResponse {
  reply: string
  irsScore: IRSScore
  isComplete: boolean
}

export interface EvaluateSessionResponse {
  report: FeedbackReport
}
