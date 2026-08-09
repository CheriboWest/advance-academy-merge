/**
 * Coaching sessions (sprint Coaching Tool, migration 019).
 *
 * A coaching session is booked by the student but worked on by the coach, and
 * the two see different halves of the same row: the student sees what they
 * submitted plus, once approved, a trimmed pack; the coach sees everything.
 * These types describe the full row — narrowing for the student happens in the
 * service layer, never by hoping the UI leaves fields out.
 */

/** Phase 1 only implements `interview_prep`; the rest are reserved. */
export type CoachingSessionType = 'interview_prep' | 'cv_review' | 'career_direction'

/**
 * Lifecycle. The student's view only ever shows `approved` and `done`; the
 * middle states exist so the coach can tell "the pipeline is still working" from
 * "the pipeline gave up" from "it needs me".
 */
export type CoachingSessionStatus =
  | 'draft'
  | 'generating'
  | 'context_needed'
  | 'ready'
  | 'failed'
  | 'approved'
  | 'done'
  | 'cancelled'

/**
 * What the student ticked in the context picker — ids only.
 *
 * Storing references rather than copies means a session never drifts from the
 * runs it was built on, and the CV text is not duplicated per booking.
 */
export interface CoachingContextRefs {
  /** `cv_versions.id` the pack should be built from. */
  cvVersionId?: string | null
  /** `tool_results.id` values: Dream Company runs, Interview Lab reports. */
  toolResultIds?: string[]
  /** `cv_analysis_jobs.id` values from the CV Optimizer. */
  cvAnalysisJobIds?: string[]
  /**
   * Pages the coach attached in the Context Desk when the research came back
   * thin — a careers page, a founder interview, a press piece. Read on the next
   * generation exactly like the company website is.
   */
  extraUrls?: string[]
}

/** One window the student offered for the session. ISO 8601. */
export type ProposedSlot = string

export interface CoachingSession {
  id: string
  studentId: string
  createdBy: string | null
  sessionType: CoachingSessionType
  status: CoachingSessionStatus

  companyName: string
  companyUrl: string | null
  jdText: string
  /** Which interview round, e.g. "final", "technical screen". */
  stage: string | null
  interviewerRole: string | null
  /** "What worries you most" — free text from the student. */
  worryText: string | null

  contextRefs: CoachingContextRefs

  /** The real interview being prepared for. Orders the coach's queue. */
  interviewAt: string | null
  proposedSlots: ProposedSlot[]
  /** The window the coach confirmed. Null until they do. */
  scheduledAt: string | null

  contextReport: unknown | null
  /**
   * Free text from the coach, fed into the generation prompt. Never sent to the
   * student — it is the coach's own working note about them.
   */
  coachNotes: string | null
  /**
   * `CoachingPack` for a coach, `StudentCoachingPack` for the student, and null
   * for the student until the coach approves it. Narrowed server-side, in
   * `getCoachingSession`, rather than by the UI choosing what to render.
   */
  generatedPack: unknown | null
  errorJson: unknown | null

  sessionNotes: SessionNotes | null
  approvedAt: string | null
  approvedBy: string | null

  createdAt: string
  updatedAt: string
}

/** POST body for booking. The coach may pass `studentId` to book on behalf. */
export interface CreateCoachingSessionRequest {
  studentId?: string
  sessionType?: CoachingSessionType
  companyName: string
  companyUrl?: string
  jdText: string
  stage?: string
  interviewerRole?: string
  worryText?: string
  contextRefs?: CoachingContextRefs
  interviewAt?: string
  proposedSlots?: ProposedSlot[]
}

// ── Context inventory + readiness (tickets T2 / T3.5) ───────────────────────

/**
 * One thing the student already has that a coaching pack could be built from.
 *
 * Deliberately light: an id, enough words to recognise it, and one headline
 * detail. This shape feeds two screens — the student's context picker at booking
 * and the coach's Context Desk — and neither needs the payload, only the choice.
 */
export interface ContextItem {
  id: string
  kind: 'cv' | 'dream_run' | 'mock_interview' | 'cv_analysis'
  /** What the student would call it, e.g. "Data Analyst · London". */
  label: string
  /** One line of substance, e.g. "readiness 7/10 · mid level". */
  detail: string | null
  createdAt: string
  /**
   * Whether this is worth including by default. A CV with bullets beats raw
   * text; a mock with a score beats an abandoned one.
   */
  recommended: boolean
}

export interface StudentContextInventory {
  studentId: string
  cvs: ContextItem[]
  dreamRuns: ContextItem[]
  mockInterviews: ContextItem[]
  cvAnalyses: ContextItem[]
}

/** How badly a gap hurts the pack that would be generated. */
export type ContextGapSeverity = 'blocking' | 'important' | 'nice_to_have'

/**
 * Something missing, phrased as work someone can do.
 *
 * The point is never to grade the student. It is to tell the coach exactly what
 * to paste into the Context Desk before spending an LLM run — "no company
 * website was supplied" is actionable, "context score 42" is not.
 */
export interface ContextGap {
  id: string
  severity: ContextGapSeverity
  /** What is missing. */
  label: string
  /** What to do about it. */
  action: string
}

/**
 *  ready        enough to generate a pack without the coach lifting a finger
 *  needs_coach  generate would produce something thin — ask the coach first
 *  blocked      a hard requirement (CV or JD) is absent; generating is pointless
 */
export type ContextReadinessVerdict = 'ready' | 'needs_coach' | 'blocked'

export interface ContextReport {
  verdict: ContextReadinessVerdict
  /** 0-100, for a progress bar. The gaps are what anyone should actually read. */
  score: number
  gaps: ContextGap[]
  /** Per-input verdicts, so the UI can tick or flag each row. */
  signals: {
    cv: 'missing' | 'raw_only' | 'good'
    jd: 'missing' | 'thin' | 'good'
    company: 'missing' | 'sparse' | 'good'
    studentHistory: 'none' | 'partial' | 'rich'
    interviewDetails: 'missing' | 'partial' | 'good'
  }
  generatedAt: string
}

// ── Company research (ticket T3) ────────────────────────────────────────────

/** One page the research actually read. Every cited claim points at one of these. */
export interface ResearchSource {
  url: string
  title: string | null
  /** Where it came from, so the coach can weigh it. */
  provider: 'exa' | 'jina' | 'companies-house'
}

/**
 * A single statement about the company, tied to the page it came from.
 *
 * The citation is not decoration. A brief that reads well but invents a funding
 * round is worse than no brief at all — the coach repeats it to the student, the
 * student repeats it in the interview. Every claim carries its source, and the
 * server drops any claim whose source is not one of the pages actually fetched.
 */
export interface CompanyFact {
  claim: string
  sourceUrl: string
}

/** Hard facts from the UK register. Null outside the UK or without a key. */
export interface CompanyRegistryFacts {
  companyNumber: string
  companyName: string
  companyStatus: string | null
  companyType: string | null
  dateOfCreation: string | null
  registeredAddress: string | null
  sicCodes: string[]
}

export interface CompanyBrief {
  companyName: string

  /**
   * True when too little was found to brief a coach properly. The pipeline says
   * so instead of padding the brief out — a thin result the coach can see is
   * thin is useful; a confident-sounding one built from nothing is a trap.
   */
  sparse: boolean
  /** Why it is sparse, in words a coach can act on. */
  sparseReasons: string[]

  /** Each section is cited. Empty is a valid answer. */
  overview: CompanyFact[]
  products: CompanyFact[]
  recentActivity: CompanyFact[]
  culture: CompanyFact[]

  /**
   * Inference, not fact — what to probe in the interview, drawn from the cited
   * material above. Kept in its own field precisely because it cannot be cited,
   * so the UI can label it as the model's reading rather than a finding.
   */
  interviewAngles: string[]

  registry: CompanyRegistryFacts | null
  sources: ResearchSource[]

  /** What the coach should add in the Context Desk, e.g. "the careers page". */
  missingInfo: string[]

  generatedAt: string
}

// ── The generated pack (ticket T4) ──────────────────────────────────────────

/**
 * Who this student is, on one page.
 *
 * The first thing a coach reads, and the thing they currently rebuild from
 * memory before every session. Assembled from the CV plus whatever the other
 * tools already learned — never from the model's imagination about them.
 */
export interface StudentOnePager {
  /** One line: who they are and what they are going for. */
  headline: string
  /** Where their career actually stands right now. */
  currentPosition: string
  strengths: string[]
  /** Drawn from mock scores and CV analysis, not guessed from the CV alone. */
  weaknesses: string[]
  /** What the other tools found, e.g. "readiness 6/10 in Dream Company". */
  historyNotes: string[]
}

/** One JD requirement, matched against what the student can actually show. */
export interface FitRow {
  requirement: string
  /** The CV evidence backing it. Null when there is none — that is the point. */
  evidence: string | null
  strength: 'strong' | 'partial' | 'gap'
  /** Where an interviewer is likely to push on this. */
  probeRisk: string | null
}

export interface SellingPoint {
  point: string
  evidence: string
}

/** A story the student can already tell, drawn from their own CV. */
export interface StarStory {
  competency: string
  situation: string
  task: string
  action: string
  result: string
  /** The CV bullet it came from, so the coach can check it is real. */
  sourceBullet: string
}

export interface FitAnalysis {
  /** How to frame this candidate for this specific role. */
  positioning: string
  sellingPoints: SellingPoint[]
  starStories: StarStory[]
  rows: FitRow[]
  /** What an interviewer will notice and worry about. */
  redFlags: string[]
}

export type QuestionCategory =
  | 'behavioural'
  | 'technical'
  | 'motivation'
  | 'company'
  | 'situational'

export interface PackQuestion {
  id: string
  question: string
  category: QuestionCategory
  difficulty: 'easy' | 'medium' | 'hard'
  /** Why this interviewer, at this round, would ask it. */
  whyAsked: string
  /** A route to a good answer built from this student's own experience. */
  suggestedAnswer: string
  /** Set by the coach in the workspace (T5), never by the model. */
  starred?: boolean
}

/** One block of the session, with the minutes it should take. */
export interface AgendaItem {
  minutes: number
  title: string
  detail: string
}

/**
 * Everything generated for one coaching session.
 *
 * `version` is here from the start: a pack is stored as jsonb and read back
 * months later by a UI that has moved on, and the alternative to a version tag
 * is guessing from which keys happen to be present.
 */
export interface CoachingPack {
  version: 1
  studentOnePager: StudentOnePager
  companyBrief: CompanyBrief
  fit: FitAnalysis
  questions: PackQuestion[]
  /** Questions the student should ask them. */
  reverseQuestions: string[]
  agenda: AgendaItem[]
  generatedAt: string
  model: string
  /** What this pack cost to produce, in USD. */
  costUsd: number
}

// ── Coach workspace (ticket T5) ─────────────────────────────────────────────

/** Fields the coach may change on a session before approving it. */
export interface UpdateCoachingSessionRequest {
  /** Free text fed into the next generation. The coach's private channel. */
  coachNotes?: string
  /** Extra pages to read next time the research runs. */
  extraUrls?: string[]
  /** The slot the coach confirmed out of the student's proposals. */
  scheduledAt?: string | null
  interviewAt?: string | null
}

/**
 * Edits to the generated pack.
 *
 * Only the parts a coach actually rewrites. The one-pager, fit table and company
 * brief are findings — if they are wrong the fix is to add context and
 * regenerate, not to hand-edit the evidence.
 */
export interface UpdateCoachingPackRequest {
  questions?: PackQuestion[]
  reverseQuestions?: string[]
  agenda?: AgendaItem[]
}

// ── After the session (ticket T6.5) ─────────────────────────────────────────

export interface ActionItem {
  text: string
  /** Ticked off by the coach at the next session, or by the student. */
  done: boolean
}

/**
 * What came out of the hour.
 *
 * This is what turns the tool from a document generator into something with a
 * memory: the next session for the same student opens with what was agreed last
 * time already on screen, instead of the coach reconstructing it.
 */
export interface SessionNotes {
  /** How it went, in the coach's words. */
  summary: string
  actionItems: ActionItem[]
  /** Anything the coach wants waiting for them next time. */
  nextTime: string
  savedAt: string
}

export interface SaveSessionNotesRequest {
  summary?: string
  actionItems?: ActionItem[]
  nextTime?: string
  /** Mark the session finished. Only meaningful once it has actually happened. */
  markDone?: boolean
}

// ── The student's view (ticket T6) ──────────────────────────────────────────

/**
 * The pack as the student sees it, once the coach has approved it.
 *
 * Three things are deliberately absent, and it is worth being explicit about
 * why: `weaknesses`, `redFlags` and the `agenda` are written FOR the coach. They
 * are blunt by design — "short tenure pattern, the panel will ask", "this is a
 * skills gap, not a framing problem" — because a coach needs the unvarnished
 * read to plan an hour. Handed to the student cold, without the coach in the
 * room to put them in context, the same sentences land as a verdict. The coach
 * delivers those in person; everything else is theirs to keep.
 */
export interface StudentCoachingPack {
  version: 1
  headline: string
  currentPosition: string
  strengths: string[]
  companyBrief: CompanyBrief
  positioning: string
  sellingPoints: SellingPoint[]
  starStories: StarStory[]
  /** Including the gaps — knowing what is not evidenced is what they prepare for. */
  fitRows: FitRow[]
  questions: PackQuestion[]
  reverseQuestions: string[]
  approvedAt: string | null
}

/** List-view shape — without the heavy pack and JD blobs. */
export interface CoachingSessionSummary {
  id: string
  studentId: string
  status: CoachingSessionStatus
  sessionType: CoachingSessionType
  companyName: string
  stage: string | null
  interviewAt: string | null
  scheduledAt: string | null
  createdAt: string
}
