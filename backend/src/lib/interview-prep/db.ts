/**
 * Supabase persistence helpers for the interview-prep flow.
 * All functions are non-throwing: they log + return null/undefined on failure
 * so a DB outage never breaks the user-facing interview.
 */
import { getSupabase } from '../supabase.js';
import type {
  InterviewContext,
  PersonaId,
  IRSScore,
  FeedbackReport,
} from '../../types/interview-prep.js';

function safeSupabase() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

interface DbSession {
  id: string;
  companyId: string | null;
  jobTargetId: string | null;
}

async function getOrCreateCompany(
  companyName: string,
  companyUrl?: string,
): Promise<string | null> {
  const supabase = safeSupabase();
  if (!supabase) return null;

  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .ilike('name', companyName)
    .limit(1)
    .single();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('companies')
    .insert({
      name: companyName,
      website_url: companyUrl || null,
      research_status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[db] Failed to create company:', error);
    return null;
  }
  return created.id;
}

async function createJobTarget(userId: string, 
  companyId: string | null,
  context: InterviewContext,
): Promise<string | null> {
  const supabase = safeSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('job_targets')
    .insert({
      user_id: userId,
      company_id: companyId,
      title: context.jobTitle,
      jd_text: context.jobDescription,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[db] Failed to create job target:', error);
    return null;
  }
  return data.id;
}

export async function dbStartSession(userId: string, 
  personaId: PersonaId,
  context: InterviewContext,
): Promise<DbSession | null> {
  const supabase = safeSupabase();
  if (!supabase) return null;
  try {
    const companyId = await getOrCreateCompany(context.companyName, context.companyUrl);
    const jobTargetId = await createJobTarget(userId, companyId, context);

    const { data, error } = await supabase
      .from('interview_sessions')
      .insert({
        user_id: userId,
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
      .single();

    if (error) {
      console.error('[db] Failed to create session:', error);
      return null;
    }
    return { id: data.id, companyId, jobTargetId };
  } catch (err) {
    console.error('[db] dbStartSession error:', err);
    return null;
  }
}

export async function dbStoreQuestion(
  sessionId: string,
  questionText: string,
): Promise<{ id: string } | null> {
  const supabase = safeSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('interview_questions')
      .insert({
        session_id: sessionId,
        question_text: questionText,
        question_type: 'behavioral',
        source: 'generated',
      })
      .select('id')
      .single();
    if (error) {
      console.error('[db] Failed to store question:', error);
      return null;
    }
    return { id: data.id };
  } catch (err) {
    console.error('[db] dbStoreQuestion error:', err);
    return null;
  }
}

export async function dbStoreAssessment(
  sessionId: string,
  questionId: string,
  candidateAnswer: string,
  irsScore: IRSScore,
): Promise<{ id: string } | null> {
  const supabase = safeSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
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
              10,
          ) / 10,
        rationale_json: {
          integrity: irsScore.integrity.rationale,
          relevance: irsScore.relevance.rationale,
          substance: irsScore.substance.rationale,
        },
      })
      .select('id')
      .single();
    if (error) {
      console.error('[db] Failed to store assessment:', error);
      return null;
    }
    return { id: data.id };
  } catch (err) {
    console.error('[db] dbStoreAssessment error:', err);
    return null;
  }
}

export async function dbCompleteSession(
  sessionId: string,
  overallIRS: IRSScore,
  report: FeedbackReport,
): Promise<void> {
  const supabase = safeSupabase();
  if (!supabase) return;
  try {
    const { error } = await supabase
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
      .eq('id', sessionId);
    if (error) console.error('[db] Failed to complete session:', error);
  } catch (err) {
    console.error('[db] dbCompleteSession error:', err);
  }
}

export async function dbUpdateSessionStatus(sessionId: string, status: string): Promise<void> {
  const supabase = safeSupabase();
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('interview_sessions')
      .update({ status })
      .eq('id', sessionId);
    if (error) console.error('[db] Failed to update session status:', error);
  } catch (err) {
    console.error('[db] dbUpdateSessionStatus error:', err);
  }
}

export async function dbListSessions(userId: string): Promise<unknown[]> {
  const supabase = safeSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('interview_sessions')
    .select(
      'id, persona_id, mode, status, started_at, ended_at, final_score_json, context_json',
    )
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[db] dbListSessions error:', error);
    return [];
  }
  return data ?? [];
}

export async function dbGetSession(id: string): Promise<unknown | null> {
  const supabase = safeSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('interview_sessions')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) {
    console.error('[db] dbGetSession error:', error);
    return null;
  }
  return data;
}
