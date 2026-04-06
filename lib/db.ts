import { supabase, isDbReady } from './supabase'
import type {
  InterviewContext,
  PersonaId,
  IRSScore,
  FeedbackReport,
  InterviewSession,
} from './types'

// ── Types for DB returns ─────────────────────────

interface DbSession {
  id: string
  companyId: string | null
  jobTargetId: string | null
}

interface DbQuestion {
  id: string
}

interface DbAssessment {
  id: string
}

// ── Helper: get or create company ────────────────

async function getOrCreateCompany(
  companyName: string,
  companyUrl?: string
): Promise<string | null> {
  if (!supabase) return null

  // Try to find existing company by name
  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .ilike('name', companyName)
    .limit(1)
    .single()

  if (existing) return existing.id

  // Create new company
  const { data: created, error } = await supabase
    .from('companies')
    .insert({
      name: companyName,
      website_url: companyUrl || null,
      research_status: 'pending',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[db] Failed to create company:', error)
    return null
  }

  return created.id
}

// ── Helper: create job target ────────────────────

async function createJobTarget(
  companyId: string | null,
  context: InterviewContext
): Promise<string | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('job_targets')
    .insert({
      // For MVP without auth, use a placeholder user_id.
      // In production, this comes from the authenticated user.
      user_id: '00000000-0000-0000-0000-000000000000',
      company_id: companyId,
      title: context.jobTitle,
      jd_text: context.jobDescription,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[db] Failed to create job target:', error)
    return null
  }

  return data.id
}

// ── Start Session ────────────────────────────────
// Called when a new interview session begins.
// Creates company, job_target, and interview_session records.

export async function dbStartSession(
  personaId: PersonaId,
  context: InterviewContext
): Promise<DbSession | null> {
  if (!isDbReady()) return null

  try {
    const companyId = await getOrCreateCompany(
      context.companyName,
      context.companyUrl
    )

    const jobTargetId = await createJobTarget(companyId, context)

    const { data, error } = await supabase!
      .from('interview_sessions')
      .insert({
        persona_id: personaId,
        job_target_id: jobTargetId,
        mode: 'live_ai',
        status: 'active',
        context_json: {
          cvText: context.cvText,
          jobTitle: context.jobTitle,
          jobDescription: context.jobDescription,
          companyName: context.companyName,
          companyUrl: context.companyUrl || null,
          extraLinks: context.extraLinks || null,
        },
      })
      .select('id')
      .single()

    if (error) {
      console.error('[db] Failed to create session:', error)
      return null
    }

    return { id: data.id, companyId, jobTargetId }
  } catch (err) {
    console.error('[db] dbStartSession error:', err)
    return null
  }
}

// ── Store Question ───────────────────────────────
// Called each time the interviewer asks a question.

export async function dbStoreQuestion(
  sessionId: string,
  questionText: string
): Promise<DbQuestion | null> {
  if (!isDbReady()) return null

  try {
    const { data, error } = await supabase!
      .from('interview_questions')
      .insert({
        session_id: sessionId,
        question_text: questionText,
        question_type: 'behavioral', // default for MVP
        source: 'generated',
      })
      .select('id')
      .single()

    if (error) {
      console.error('[db] Failed to store question:', error)
      return null
    }

    return { id: data.id }
  } catch (err) {
    console.error('[db] dbStoreQuestion error:', err)
    return null
  }
}

// ── Store Assessment ─────────────────────────────
// Called each time a candidate answer is scored with IRS.

export async function dbStoreAssessment(
  sessionId: string,
  questionId: string,
  candidateAnswer: string,
  irsScore: IRSScore
): Promise<DbAssessment | null> {
  if (!isDbReady()) return null

  try {
    const { data, error } = await supabase!
      .from('answer_assessments')
      .insert({
        session_id: sessionId,
        question_id: questionId,
        candidate_answer: candidateAnswer,
        integrity_score: irsScore.integrity.score,
        relevance_score: irsScore.relevance.score,
        substance_score: irsScore.substance.score,
        overall_score:
          irsScore.overall ??
          Math.round(
            (irsScore.integrity.score * 0.3 +
              irsScore.relevance.score * 0.3 +
              irsScore.substance.score * 0.4) *
              10
          ) / 10,
        rationale_json: {
          integrity: irsScore.integrity.rationale,
          relevance: irsScore.relevance.rationale,
          substance: irsScore.substance.rationale,
        },
      })
      .select('id')
      .single()

    if (error) {
      console.error('[db] Failed to store assessment:', error)
      return null
    }

    return { id: data.id }
  } catch (err) {
    console.error('[db] dbStoreAssessment error:', err)
    return null
  }
}

// ── Store Coaching ───────────────────────────────
// Called for each answer assessment during report generation.

export async function dbStoreCoaching(
  assessmentId: string,
  originalAnswer: string,
  coaching: {
    critique: string
    improvedAnswer: string
    bestSampleAnswer: string
  }
): Promise<void> {
  if (!isDbReady()) return

  try {
    const { error } = await supabase!.from('answer_coaching').insert({
      assessment_id: assessmentId,
      original_answer: originalAnswer,
      critique_json: { critique: coaching.critique },
      improved_answer: coaching.improvedAnswer,
      best_sample_answer: coaching.bestSampleAnswer,
    })

    if (error) {
      console.error('[db] Failed to store coaching:', error)
    }
  } catch (err) {
    console.error('[db] dbStoreCoaching error:', err)
  }
}

// ── Complete Session ─────────────────────────────
// Called when the interview ends and the report is generated.

export async function dbCompleteSession(
  sessionId: string,
  overallIRS: IRSScore,
  report: FeedbackReport
): Promise<void> {
  if (!isDbReady()) return

  try {
    const { error } = await supabase!
      .from('interview_sessions')
      .update({
        status: 'complete',
        ended_at: new Date().toISOString(),
        final_score_json: {
          integrity: overallIRS.integrity.score,
          relevance: overallIRS.relevance.score,
          substance: overallIRS.substance.score,
          overall: overallIRS.overall,
        },
        final_report_json: {
          strengths: report.strengths,
          improvements: report.improvements,
          summary: report.summary,
          generatedAt: report.generatedAt,
        },
      })
      .eq('id', sessionId)

    if (error) {
      console.error('[db] Failed to complete session:', error)
    }
  } catch (err) {
    console.error('[db] dbCompleteSession error:', err)
  }
}

// ── Update Session Status ────────────────────────

export async function dbUpdateSessionStatus(
  sessionId: string,
  status: string
): Promise<void> {
  if (!isDbReady()) return

  try {
    const { error } = await supabase!
      .from('interview_sessions')
      .update({ status })
      .eq('id', sessionId)

    if (error) {
      console.error('[db] Failed to update session status:', error)
    }
  } catch (err) {
    console.error('[db] dbUpdateSessionStatus error:', err)
  }
}
