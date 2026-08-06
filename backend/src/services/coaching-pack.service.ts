/**
 * Coaching pack generation (sprint Coaching Tool, ticket T4).
 *
 * Turns a booking into the document a coach walks into the session with. Four
 * Sonnet calls behind a Stage 0 gate:
 *
 *    load context  (DB only, no tokens)
 *      └─ Stage 0 readiness — not ready? stop here, cost so far: nothing
 *    1. company research      (T3, cited)
 *    2. one-pager + fit       JD against what the CV can evidence
 *    3. questions             weighted to the round and the interviewer
 *    4. agenda                how to spend the hour
 *
 * **Asynchronous by necessity, not preference.** Company research alone measured
 * 44s on Sonnet; four calls plus web fetches comfortably clears the 120s the
 * backend client allows. So the `coaching_sessions` row *is* the job: status
 * moves generating → ready | context_needed | failed, and the client polls it.
 * No separate jobs table — a pack belongs to exactly one session and outliving
 * it would mean nothing.
 *
 * Every stage writes its result to the row before the next begins. A failure at
 * step 4 therefore leaves the research and fit analysis banked rather than
 * discarding three paid-for calls.
 */

import type {
  AgendaItem,
  CoachingPack,
  CompanyBrief,
  FitAnalysis,
  PackQuestion,
  QuestionCategory,
  StudentOnePager,
} from '@advance-academy/contracts/coaching';
import { getSupabase } from '../lib/supabase.js';
import { newCostBucket, type CostBucket } from '../lib/cost-tracker.js';
import {
  assertLlmConfigured,
  createAnthropicClient,
  getFeatureModel,
  withRetry,
} from '../lib/llm-anthropic.js';
import {
  AGENDA_SYSTEM,
  PROFILE_FIT_SYSTEM,
  QUESTIONS_SYSTEM,
  REGENERATE_QUESTION_SYSTEM,
  buildAgendaUser,
  buildProfileFitUser,
  buildQuestionsUser,
  buildRegenerateQuestionUser,
  type InterviewFacts,
  type StudentDossier,
} from '../lib/coaching/prompts.js';
import { researchCompany } from './company-research.service.js';
import { assessContextReadiness, listStudentContext } from './coaching-context.service.js';

/** How long a coaching session runs. Drives the agenda's minute budget. */
const DEFAULT_SESSION_MINUTES = 60;

const STAGE_TIMEOUT_MS = 120_000;
const PROFILE_FIT_MAX_TOKENS = 6000;
const QUESTIONS_MAX_TOKENS = 8000;
const AGENDA_MAX_TOKENS = 2000;

const QUESTION_CATEGORIES: QuestionCategory[] = [
  'behavioural',
  'technical',
  'motivation',
  'company',
  'situational',
];

// ── Context loading (no tokens) ─────────────────────────────────────────────

interface SessionRow {
  id: string;
  student_id: string;
  company_name: string;
  company_url: string | null;
  jd_text: string;
  stage: string | null;
  interviewer_role: string | null;
  worry_text: string | null;
  coach_notes: string | null;
  context_refs: {
    cvVersionId?: string | null;
    toolResultIds?: string[];
    cvAnalysisJobIds?: string[];
    extraUrls?: string[];
  } | null;
}

/** Trim a long list to what is worth paying for, newest/strongest first. */
function take<T>(items: T[], n: number): T[] {
  return items.slice(0, n);
}

/**
 * The CV the pack is built from: the one the student ticked, else their active
 * Library CV, else the most recent thing we hold.
 */
async function loadCv(
  studentId: string,
  cvVersionId: string | null | undefined,
): Promise<{ text: string; bullets: string[] }> {
  const supabase = getSupabase();

  // Scoped by user_id in both branches: the ticked id was validated at booking,
  // but a pack generated months later must not trust that check to still hold.
  const base = supabase.from('cv_versions').select('id, raw_text').eq('user_id', studentId);
  const { data } = await (cvVersionId
    ? base.eq('id', cvVersionId).limit(1)
    : base
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1));

  const row = data?.[0];
  if (!row) return { text: '', bullets: [] };

  // Bullets only exist when the CV went through the Library. Their absence is
  // normal, and the prompt copes — it just cannot cite exact lines.
  const { data: junction } = await supabase
    .from('cv_version_bullets')
    .select('bullet_id, ordinal')
    .eq('cv_version_id', row.id as string)
    .order('ordinal', { ascending: true });

  const bulletIds = (junction ?? []).map((j) => j.bullet_id as string);
  let bullets: string[] = [];
  if (bulletIds.length > 0) {
    const { data: bulletRows } = await supabase
      .from('cv_bullets')
      .select('id, bullet_text')
      .in('id', take(bulletIds, 60));
    const byId = new Map((bulletRows ?? []).map((b) => [b.id as string, b.bullet_text as string]));
    bullets = bulletIds.map((id) => byId.get(id)).filter((b): b is string => Boolean(b));
  }

  return { text: (row.raw_text as string) ?? '', bullets };
}

/**
 * Flatten the other tools' output into lines a prompt can use.
 *
 * Only what says something about *this student* — a Dream Company roadmap is
 * mostly job listings, and pasting it in would spend tokens teaching the model
 * about the job market rather than about the candidate.
 */
async function loadToolFindings(
  studentId: string,
  refs: SessionRow['context_refs'],
): Promise<string[]> {
  const supabase = getSupabase();
  const findings: string[] = [];

  const toolResultIds = take(refs?.toolResultIds ?? [], 6);
  if (toolResultIds.length > 0) {
    const { data } = await supabase
      .from('tool_results')
      .select('tool, input_summary, input_json, result')
      .eq('user_id', studentId)
      .in('id', toolResultIds);

    for (const row of data ?? []) {
      const input = (row.input_json ?? {}) as Record<string, unknown>;

      if (row.tool === 'dream') {
        const analysis = (input.analysis ?? null) as Record<string, unknown> | null;
        if (!analysis) continue;
        if (typeof analysis.marketLevel === 'string') {
          findings.push(`Dream Company placed them at ${analysis.marketLevel} level.`);
        }
        if (typeof analysis.readinessScore === 'number') {
          findings.push(`Dream Company scored their readiness ${analysis.readinessScore}/10.`);
        }
        for (const s of take((analysis.coreStrengths ?? []) as { strength?: string; evidence?: string }[], 4)) {
          if (s.strength) findings.push(`Strength found: ${s.strength}${s.evidence ? ` — ${s.evidence}` : ''}`);
        }
        for (const g of take((analysis.criticalGaps ?? []) as { gap?: string; impact?: string }[], 4)) {
          if (g.gap) findings.push(`Gap found: ${g.gap}${g.impact ? ` — ${g.impact}` : ''}`);
        }
      }

      if (row.tool === 'interview') {
        const report = (row.result ?? {}) as Record<string, unknown>;
        const irs = (report.overallIRS ?? {}) as Record<string, { score?: number }>;
        const parts = ['integrity', 'relevance', 'substance']
          .map((k) => (typeof irs[k]?.score === 'number' ? `${k} ${irs[k].score}` : null))
          .filter(Boolean);
        if (parts.length > 0) {
          findings.push(`Mock interview (${row.input_summary ?? 'practice'}) scored ${parts.join(', ')}.`);
        }
        for (const imp of take((report.improvements ?? []) as { title?: string; detail?: string }[], 4)) {
          if (imp.title) findings.push(`Mock feedback: ${imp.title}${imp.detail ? ` — ${imp.detail}` : ''}`);
        }
      }
    }
  }

  const analysisIds = take(refs?.cvAnalysisJobIds ?? [], 3);
  if (analysisIds.length > 0) {
    const { data } = await supabase
      .from('cv_analysis_jobs')
      .select('input_json, result_json')
      .eq('user_id', studentId)
      .in('id', analysisIds);

    for (const row of data ?? []) {
      const result = (row.result_json ?? {}) as Record<string, unknown>;
      if (typeof result.overallScore === 'number') {
        const role = (row.input_json as Record<string, unknown> | null)?.targetRole;
        findings.push(
          `CV Optimiser scored their CV ${result.overallScore}/100${typeof role === 'string' ? ` for ${role}` : ''}.`,
        );
      }
      // The weak bullets are the useful part: they are exactly what the student
      // will be asked to expand on out loud.
      const weak = take(
        ((result.bulletEvaluations ?? []) as { original?: string; impactScore?: number; feedback?: string }[])
          .filter((b) => typeof b.impactScore === 'number' && b.impactScore <= 5),
        5,
      );
      for (const b of weak) {
        if (b.original) findings.push(`Weak CV bullet: "${b.original}"${b.feedback ? ` — ${b.feedback}` : ''}`);
      }
    }
  }

  return take(findings, 30);
}

// ── LLM stages ──────────────────────────────────────────────────────────────

function stripJsonFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

async function runStage<T>(args: {
  label: string;
  system: string;
  user: string;
  maxTokens: number;
  cost: CostBucket;
}): Promise<T> {
  const { label, system, user, maxTokens, cost } = args;
  assertLlmConfigured('coaching');
  const anthropic = createAnthropicClient('coaching', { timeoutMs: STAGE_TIMEOUT_MS });
  const model = getFeatureModel('coaching');

  const response = await withRetry(() =>
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  );
  cost.llm(`coaching.${label}`, model, response.usage);

  if (response.stop_reason === 'max_tokens') {
    throw Object.assign(new Error(`The ${label} step was cut off.`), {
      statusCode: 502,
      step: `coaching-${label}`,
    });
  }
  const block = response.content[0];
  if (!block || block.type !== 'text') {
    throw Object.assign(new Error(`The ${label} step returned nothing.`), {
      statusCode: 502,
      step: `coaching-${label}`,
    });
  }
  try {
    return JSON.parse(stripJsonFences(block.text)) as T;
  } catch {
    throw Object.assign(new Error(`Could not parse the ${label} step.`), {
      statusCode: 500,
      step: `coaching-${label}`,
    });
  }
}

// ── Normalisation (pure — unit-tested) ──────────────────────────────────────

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function strList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(0, max);
}

export function normaliseOnePager(raw: unknown): StudentOnePager {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    headline: str(o.headline),
    currentPosition: str(o.currentPosition),
    strengths: strList(o.strengths, 8),
    weaknesses: strList(o.weaknesses, 8),
    historyNotes: strList(o.historyNotes, 10),
  };
}

export function normaliseFit(raw: unknown): FitAnalysis {
  const f = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(f.rows) ? f.rows : [];
  const points = Array.isArray(f.sellingPoints) ? f.sellingPoints : [];
  const stories = Array.isArray(f.starStories) ? f.starStories : [];

  return {
    positioning: str(f.positioning),
    sellingPoints: points
      .map((p) => ({ point: str((p as Record<string, unknown>)?.point), evidence: str((p as Record<string, unknown>)?.evidence) }))
      .filter((p) => p.point)
      .slice(0, 6),
    starStories: stories
      .map((s) => {
        const st = (s ?? {}) as Record<string, unknown>;
        return {
          competency: str(st.competency),
          situation: str(st.situation),
          task: str(st.task),
          action: str(st.action),
          result: str(st.result),
          sourceBullet: str(st.sourceBullet),
        };
      })
      .filter((s) => s.competency && s.action)
      .slice(0, 5),
    rows: rows
      .map((r) => {
        const row = (r ?? {}) as Record<string, unknown>;
        const evidence = str(row.evidence);
        const declared = str(row.strength);
        const strength: FitRowStrength =
          declared === 'strong' || declared === 'partial' || declared === 'gap'
            ? declared
            : // A row with no evidence is a gap whatever the model called it —
              // the coach must not read an unevidenced requirement as covered.
              evidence
              ? 'partial'
              : 'gap';
        return {
          requirement: str(row.requirement),
          evidence: evidence || null,
          strength: evidence ? strength : 'gap',
          probeRisk: str(row.probeRisk) || null,
        };
      })
      .filter((r) => r.requirement)
      .slice(0, 15),
    redFlags: strList(f.redFlags, 6),
  };
}

type FitRowStrength = FitAnalysis['rows'][number]['strength'];

export function normaliseQuestions(raw: unknown, sessionId: string): PackQuestion[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((q, index) => {
      const item = (q ?? {}) as Record<string, unknown>;
      const category = str(item.category) as QuestionCategory;
      const difficulty = str(item.difficulty) as PackQuestion['difficulty'];
      return {
        // Stable and derived, so the coach's edits in T5 survive a re-read of
        // the pack. A random id would break every starred flag on reload.
        id: `${sessionId.slice(0, 8)}-q${index + 1}`,
        question: str(item.question),
        category: QUESTION_CATEGORIES.includes(category) ? category : 'behavioural',
        difficulty:
          difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard'
            ? difficulty
            : 'medium',
        whyAsked: str(item.whyAsked),
        suggestedAnswer: str(item.suggestedAnswer),
      };
    })
    .filter((q) => q.question)
    .slice(0, 25);
}

/**
 * Keep the agenda honest about the clock.
 *
 * A coach reads the minutes as a plan, so an agenda summing to 90 for a 60
 * minute session quietly makes them overrun. Scale rather than reject: the
 * proportions the model chose are the useful part.
 */
export function normaliseAgenda(raw: unknown, sessionMinutes: number): AgendaItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const items = list
    .map((a) => {
      const item = (a ?? {}) as Record<string, unknown>;
      const minutes = Number(item.minutes);
      return {
        minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
        title: str(item.title),
        detail: str(item.detail),
      };
    })
    .filter((a) => a.title && a.minutes > 0)
    .slice(0, 8);

  const total = items.reduce((sum, a) => sum + a.minutes, 0);
  if (total === 0 || total === sessionMinutes) return items;

  const scaled = items.map((a) => ({ ...a, minutes: Math.max(1, Math.round((a.minutes / total) * sessionMinutes)) }));
  // Rounding leaves a remainder; put it on the longest block, where a minute
  // either way is invisible.
  const drift = sessionMinutes - scaled.reduce((sum, a) => sum + a.minutes, 0);
  if (drift !== 0 && scaled.length > 0) {
    const longest = scaled.reduce((best, a, i) => (a.minutes > scaled[best].minutes ? i : best), 0);
    scaled[longest].minutes = Math.max(1, scaled[longest].minutes + drift);
  }
  return scaled;
}

/** One line per cited company claim, for prompts that need the findings not the shape. */
export function flattenCompanyFacts(brief: CompanyBrief, max = 25): string[] {
  return [...brief.overview, ...brief.products, ...brief.recentActivity, ...brief.culture]
    .map((f) => f.claim)
    .filter(Boolean)
    .slice(0, max);
}

// ── Orchestration ───────────────────────────────────────────────────────────

async function setStatus(
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabase()
    .from('coaching_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) console.error(`[coaching-pack] could not update ${sessionId}:`, error.message);
}

export interface GeneratePackOptions {
  /** Minutes the coaching session will run. */
  sessionMinutes?: number;
  /**
   * Generate even when Stage 0 says the context is thin. This is the coach
   * pressing "generate anyway" from the Context Desk after adding what they can.
   */
  force?: boolean;
}

/**
 * Run the pipeline for one session and store the result on its row.
 *
 * Resolves rather than throws on the expected outcomes — a thin context and a
 * failed stage are both states the coach needs to see on the row, not errors
 * for a caller that has already returned 202 to the client.
 */
export async function generateCoachingPack(
  sessionId: string,
  opts: GeneratePackOptions = {},
): Promise<{ status: 'ready' | 'context_needed' | 'failed' }> {
  const sessionMinutes = opts.sessionMinutes ?? DEFAULT_SESSION_MINUTES;
  const supabase = getSupabase();

  const { data: sessionRow, error: readErr } = await supabase
    .from('coaching_sessions')
    .select(
      'id, student_id, company_name, company_url, jd_text, stage, interviewer_role, worry_text, coach_notes, context_refs',
    )
    .eq('id', sessionId)
    .maybeSingle();

  if (readErr || !sessionRow) {
    throw Object.assign(new Error('No such coaching session.'), { statusCode: 404 });
  }
  const session = sessionRow as unknown as SessionRow;

  await setStatus(sessionId, { status: 'generating', error_json: null });
  const cost = newCostBucket('coaching.generatePack');

  try {
    // ── Load everything, spend nothing ──
    const [cv, toolFindings, inventory] = await Promise.all([
      loadCv(session.student_id, session.context_refs?.cvVersionId),
      loadToolFindings(session.student_id, session.context_refs),
      listStudentContext(session.student_id),
    ]);

    const facts: InterviewFacts = {
      companyName: session.company_name,
      jdText: session.jd_text,
      stage: session.stage,
      interviewerRole: session.interviewer_role,
      // The coach's own notes ride along with the student's worry: it is the one
      // channel for knowledge the system can never derive, like "this student
      // freezes on competency questions".
      worryText: [session.worry_text, session.coach_notes].filter(Boolean).join('\n\n') || null,
    };

    // ── Stage 1: company research (cited) ──
    const companyBrief = await researchCompany({
      companyName: session.company_name,
      companyUrl: session.company_url ?? undefined,
      jdText: session.jd_text,
      // Pages the coach attached in the Context Desk. This is the whole point of
      // that screen: a sparse first run becomes a real brief on the second.
      extraUrls: session.context_refs?.extraUrls ?? undefined,
    });

    // ── Stage 0 gate, now that the company verdict is known ──
    const readiness = assessContextReadiness({
      inventory,
      jdText: session.jd_text,
      companyUrl: session.company_url ?? undefined,
      companySparse: companyBrief.sparse,
      stage: session.stage ?? undefined,
      interviewerRole: session.interviewer_role ?? undefined,
      worryText: session.worry_text ?? undefined,
    });

    if (!opts.force && readiness.verdict !== 'ready') {
      // Stop before the three expensive stages. The research is banked, so the
      // coach opens the Context Desk with the brief already in front of them.
      cost.flush();
      await setStatus(sessionId, {
        status: 'context_needed',
        context_report: readiness,
        generated_pack: { version: 1, companyBrief, partial: true },
      });
      return { status: 'context_needed' };
    }
    await setStatus(sessionId, { context_report: readiness });

    const dossier: StudentDossier = {
      cvText: cv.text,
      cvBullets: cv.bullets,
      toolFindings,
    };
    const companyFacts = flattenCompanyFacts(companyBrief);

    // ── Stage 2: one-pager + fit ──
    const profileFit = await runStage<{ studentOnePager?: unknown; fit?: unknown }>({
      label: 'profileFit',
      system: PROFILE_FIT_SYSTEM,
      user: buildProfileFitUser({ dossier, facts, companyFacts }),
      maxTokens: PROFILE_FIT_MAX_TOKENS,
      cost,
    });
    const studentOnePager = normaliseOnePager(profileFit.studentOnePager);
    const fit = normaliseFit(profileFit.fit);

    // ── Stage 3: questions ──
    const questionsRaw = await runStage<{ questions?: unknown; reverseQuestions?: unknown }>({
      label: 'questions',
      system: QUESTIONS_SYSTEM,
      user: buildQuestionsUser({ facts, fitJson: JSON.stringify(fit), companyFacts }),
      maxTokens: QUESTIONS_MAX_TOKENS,
      cost,
    });
    const questions = normaliseQuestions(questionsRaw.questions, sessionId);
    const reverseQuestions = strList(questionsRaw.reverseQuestions, 6);

    // ── Stage 4: agenda ──
    const agendaRaw = await runStage<{ agenda?: unknown }>({
      label: 'agenda',
      system: AGENDA_SYSTEM,
      user: buildAgendaUser({
        facts,
        sessionMinutes,
        onePagerJson: JSON.stringify(studentOnePager),
        fitJson: JSON.stringify(fit),
        questionSummary: questions.map((q) => `${q.question} [${q.category}, ${q.difficulty}]`),
      }),
      maxTokens: AGENDA_MAX_TOKENS,
      cost,
    });
    const agenda = normaliseAgenda(agendaRaw.agenda, sessionMinutes);

    const totalCost = cost.flush();
    const pack: CoachingPack = {
      version: 1,
      studentOnePager,
      companyBrief,
      fit,
      questions,
      reverseQuestions,
      agenda,
      generatedAt: new Date().toISOString(),
      model: getFeatureModel('coaching'),
      costUsd: totalCost,
    };

    await setStatus(sessionId, { status: 'ready', generated_pack: pack, error_json: null });
    return { status: 'ready' };
  } catch (error) {
    cost.flush();
    const message = error instanceof Error ? error.message : 'Pack generation failed.';
    const step = (error as { step?: string })?.step ?? 'unknown';
    console.error(`[coaching-pack] ${sessionId} failed at ${step}:`, message);
    // Recorded on the row rather than thrown away: the coach needs to know which
    // stage died before deciding whether retrying is worth another four calls.
    await setStatus(sessionId, {
      status: 'failed',
      error_json: { message, step, failedAt: new Date().toISOString() },
    });
    return { status: 'failed' };
  }
}

/**
 * Replace one question in an existing pack (ticket T5).
 *
 * The coach's "not this one" button. One small call rather than regenerating the
 * whole pack, because rejecting a single question is by far the most common
 * edit and re-running four stages for it would be absurd.
 *
 * The replacement is written back to the row here so the pack on disk is always
 * what the coach is looking at — no half-saved state if they close the tab.
 */
export async function regenerateQuestion(args: {
  sessionId: string;
  questionId: string;
  /** What the coach asked for, e.g. "make it harder", "focus on the SQL gap". */
  direction?: string;
}): Promise<PackQuestion> {
  const { sessionId, questionId, direction } = args;
  const supabase = getSupabase();

  const { data: row } = await supabase
    .from('coaching_sessions')
    .select('status, company_name, jd_text, stage, interviewer_role, worry_text, coach_notes, generated_pack')
    .eq('id', sessionId)
    .maybeSingle();
  if (!row) throw Object.assign(new Error('No such session.'), { statusCode: 404 });
  if (row.status === 'approved' || row.status === 'done') {
    throw Object.assign(new Error('This session is approved and locked.'), {
      statusCode: 409,
      code: 'SESSION_LOCKED',
    });
  }

  const pack = row.generated_pack as CoachingPack | null;
  const index = pack?.questions.findIndex((q) => q.id === questionId) ?? -1;
  if (!pack || index < 0) {
    throw Object.assign(new Error('No such question in this pack.'), { statusCode: 404 });
  }

  const facts: InterviewFacts = {
    companyName: row.company_name as string,
    jdText: row.jd_text as string,
    stage: (row.stage as string | null) ?? null,
    interviewerRole: (row.interviewer_role as string | null) ?? null,
    worryText:
      [row.worry_text as string | null, row.coach_notes as string | null].filter(Boolean).join('\n\n') ||
      null,
  };

  const cost = newCostBucket('coaching.regenerateQuestion');
  const raw = await runStage<Record<string, unknown>>({
    label: 'regenerateQuestion',
    system: REGENERATE_QUESTION_SYSTEM,
    user: buildRegenerateQuestionUser({
      facts,
      currentQuestion: pack.questions[index].question,
      otherQuestions: pack.questions.filter((_, i) => i !== index).map((q) => q.question),
      direction: direction?.trim() || null,
      fitJson: JSON.stringify(pack.fit),
    }),
    maxTokens: 1200,
    cost,
  });
  cost.flush();

  // Reuse normaliseQuestions for one item so a regenerated question is validated
  // exactly like a generated one, then keep the original id: the coach's starred
  // flag and the agenda both refer to it.
  const [normalised] = normaliseQuestions([raw], sessionId);
  if (!normalised) {
    throw Object.assign(new Error('The replacement question came back empty.'), {
      statusCode: 502,
      step: 'coaching-regenerateQuestion',
    });
  }
  const replacement: PackQuestion = {
    ...normalised,
    id: questionId,
    starred: pack.questions[index].starred,
  };

  const questions = [...pack.questions];
  questions[index] = replacement;
  const { error } = await supabase
    .from('coaching_sessions')
    .update({ generated_pack: { ...pack, questions }, updated_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) {
    throw Object.assign(new Error('Could not save the new question'), { statusCode: 500, cause: error });
  }

  return replacement;
}
