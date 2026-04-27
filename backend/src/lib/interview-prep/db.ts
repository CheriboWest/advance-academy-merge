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

interface MissingEvidencePromptRow {
  bulletId: string | null;
  bulletText: string | null;
  question: string;
}

interface SessionExchangeCoach {
  critique: string;
  improved_answer: string;
  missing_evidence_prompts: MissingEvidencePromptRow[];
  created_at: string;
}

interface SessionExchangeRow {
  question_text: string;
  candidate_answer: string;
  integrity_score: number;
  relevance_score: number;
  substance_score: number;
  overall_score: number;
  integrity_rationale: string | null;
  relevance_rationale: string | null;
  substance_rationale: string | null;
  asked_at: string;
  coach: SessionExchangeCoach | null;
}

interface RawCoachRow {
  critique_json: {
    critique?: string;
    missingEvidencePrompts?: MissingEvidencePromptRow[];
  } | null;
  improved_answer: string | null;
  created_at: string;
}

interface RawAssessmentRow {
  candidate_answer: string | null;
  integrity_score: number;
  relevance_score: number;
  substance_score: number;
  overall_score: number;
  rationale_json: { integrity?: string; relevance?: string; substance?: string } | null;
  created_at: string;
  interview_questions: { question_text: string; asked_at: string } | null;
  answer_coaching: RawCoachRow[] | null;
}

export async function dbGetSession(
  id: string,
): Promise<(Record<string, unknown> & { exchanges: SessionExchangeRow[] }) | null> {
  const supabase = safeSupabase();
  if (!supabase) return null;

  const { data: sessionRow, error: sessionErr } = await supabase
    .from('interview_sessions')
    .select('*')
    .eq('id', id)
    .single();
  if (sessionErr || !sessionRow) {
    console.error('[db] dbGetSession error:', sessionErr);
    return null;
  }

  // Reconstruct the conversation by joining assessments → questions.
  // We anchor on answer_assessments because dbStoreQuestion is called twice per
  // interviewer turn (once when generated, once when the candidate's next turn
  // re-stores it as `lastQuestion`); the assessment is linked to the second row,
  // which gives us a natural dedupe.
  const { data: rawAssessments, error: exErr } = await supabase
    .from('answer_assessments')
    .select(
      'candidate_answer, integrity_score, relevance_score, substance_score, overall_score, rationale_json, created_at, interview_questions ( question_text, asked_at ), answer_coaching ( critique_json, improved_answer, created_at )',
    )
    .eq('session_id', id)
    .order('created_at', { ascending: true });

  if (exErr) {
    console.error('[db] dbGetSession exchanges error:', exErr);
    return { ...sessionRow, exchanges: [] };
  }

  const exchanges: SessionExchangeRow[] = ((rawAssessments ?? []) as unknown as RawAssessmentRow[])
    .filter((row) => row.interview_questions != null)
    .map((row) => ({
      question_text: row.interview_questions!.question_text,
      candidate_answer: row.candidate_answer ?? '',
      integrity_score: Number(row.integrity_score),
      relevance_score: Number(row.relevance_score),
      substance_score: Number(row.substance_score),
      overall_score: Number(row.overall_score),
      integrity_rationale: row.rationale_json?.integrity ?? null,
      relevance_rationale: row.rationale_json?.relevance ?? null,
      substance_rationale: row.rationale_json?.substance ?? null,
      asked_at: row.interview_questions!.asked_at,
      coach: pickLatestCoach(row.answer_coaching),
    }));

  return { ...sessionRow, exchanges };
}

// Multiple coach generations are allowed per assessment (re-coach after JIT
// clarifications). Surface the most recent.
function pickLatestCoach(rows: RawCoachRow[] | null): SessionExchangeCoach | null {
  if (!rows || rows.length === 0) return null;
  const latest = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
  if (!latest.improved_answer) return null;
  return {
    critique: latest.critique_json?.critique ?? '',
    improved_answer: latest.improved_answer,
    missing_evidence_prompts: latest.critique_json?.missingEvidencePrompts ?? [],
    created_at: latest.created_at,
  };
}

export async function dbStoreCoaching(
  assessmentId: string,
  originalAnswer: string,
  critique: string,
  improvedAnswer: string,
  missingEvidencePrompts: MissingEvidencePromptRow[],
): Promise<{ id: string } | null> {
  const supabase = safeSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('answer_coaching')
      .insert({
        assessment_id: assessmentId,
        original_answer: originalAnswer,
        critique_json: {
          critique,
          missingEvidencePrompts,
        },
        improved_answer: improvedAnswer,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[db] Failed to store coaching:', error);
      return null;
    }
    return { id: data.id };
  } catch (err) {
    console.error('[db] dbStoreCoaching error:', err);
    return null;
  }
}
