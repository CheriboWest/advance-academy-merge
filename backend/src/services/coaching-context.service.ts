/**
 * Student context inventory + readiness (sprint Coaching Tool, tickets T2/T3.5).
 *
 * Two jobs, one module, because they are two readings of the same question —
 * "what do we know about this student?":
 *
 *  1. `listStudentContext` — everything they have already produced, as a pickable
 *     list. Feeds the context picker at booking and the coach's Context Desk.
 *  2. `assessContextReadiness` — is that enough to generate a pack worth reading?
 *
 * The second is what makes the tool cheap to run. Generating a pack costs four
 * LLM calls; doing it on a booking with no CV and a forty-word JD produces
 * something the coach throws away, having paid for it. Stage 0 spends no tokens
 * at all and decides whether the expensive part should happen yet.
 *
 * The output is deliberately gap-shaped, not score-shaped. A coach can act on
 * "no company website was supplied"; nobody can act on "readiness 42%".
 */

import type {
  ContextGap,
  ContextItem,
  ContextReadinessVerdict,
  ContextReport,
  StudentContextInventory,
} from '@advance-academy/contracts/coaching';
import { getSupabase } from '../lib/supabase.js';

/** A JD shorter than this is a job title and a wish, not a description. */
const JD_THIN_CHARS = 400;
/** Below this, there is nothing to align a CV against. */
const JD_MISSING_CHARS = 60;

// ── Inventory ───────────────────────────────────────────────────────────────

interface CvVersionRow {
  id: string;
  name: string;
  origin: string | null;
  is_active: boolean;
  created_at: string;
}

/**
 * Every CV the student has, Library uploads and copies other tools kept alike
 * (migration 018). Bullet counts come from the junction table, so a CV parsed
 * into the knowledge base is distinguishable from raw captured text — the coach
 * should reach for the former.
 */
async function listCvs(studentId: string): Promise<ContextItem[]> {
  const supabase = getSupabase();

  const { data: versions, error } = await supabase
    .from('cv_versions')
    .select('id, name, origin, is_active, created_at')
    .eq('user_id', studentId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    throw Object.assign(new Error('Could not load the student CVs'), { statusCode: 500, cause: error });
  }

  const rows = (versions ?? []) as CvVersionRow[];
  if (rows.length === 0) return [];

  const { data: junctions } = await supabase
    .from('cv_version_bullets')
    .select('cv_version_id')
    .in('cv_version_id', rows.map((r) => r.id));

  const bulletCounts = new Map<string, number>();
  for (const j of junctions ?? []) {
    const key = j.cv_version_id as string;
    bulletCounts.set(key, (bulletCounts.get(key) ?? 0) + 1);
  }

  return rows.map((row) => {
    const bullets = bulletCounts.get(row.id) ?? 0;
    return {
      id: row.id,
      kind: 'cv' as const,
      label: row.name,
      detail: bullets > 0 ? `${bullets} bullets parsed` : 'raw text only, not parsed',
      createdAt: row.created_at,
      // The active Library CV first, then anything with bullets. A raw copy
      // captured in passing works, but only when nothing better exists.
      recommended: row.is_active || bullets > 0,
    };
  });
}

interface ToolResultRow {
  id: string;
  tool: string;
  input_summary: string | null;
  created_at: string;
  input_json: Record<string, unknown> | null;
}

/** Read the one detail from each run that tells a coach whether to bother. */
function describeDreamRun(row: ToolResultRow): string | null {
  const analysis = (row.input_json?.analysis ?? null) as Record<string, unknown> | null;
  if (!analysis) return null;
  const level = typeof analysis.marketLevel === 'string' ? analysis.marketLevel : null;
  const readiness = typeof analysis.readinessScore === 'number' ? analysis.readinessScore : null;
  const gaps = Array.isArray(analysis.criticalGaps) ? analysis.criticalGaps.length : null;
  return (
    [
      readiness !== null ? `readiness ${readiness}/10` : null,
      level ? `${level} level` : null,
      gaps ? `${gaps} critical gaps` : null,
    ]
      .filter(Boolean)
      .join(' · ') || null
  );
}

function describeMock(row: ToolResultRow): string | null {
  const input = row.input_json ?? {};
  const persona = typeof input.personaId === 'string' ? input.personaId : null;
  const hasJd = typeof input.jobDescription === 'string' && input.jobDescription.trim().length > 0;
  return [persona ? `${persona} interviewer` : null, hasJd ? 'JD attached' : null]
    .filter(Boolean)
    .join(' · ') || null;
}

async function listToolRuns(
  studentId: string,
): Promise<{ dreamRuns: ContextItem[]; mockInterviews: ContextItem[] }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tool_results')
    .select('id, tool, input_summary, created_at, input_json')
    .eq('user_id', studentId)
    .in('tool', ['dream', 'interview'])
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    throw Object.assign(new Error('Could not load the student tool history'), {
      statusCode: 500,
      cause: error,
    });
  }

  const rows = (data ?? []) as ToolResultRow[];
  const dreamRuns: ContextItem[] = [];
  const mockInterviews: ContextItem[] = [];

  for (const row of rows) {
    const isDream = row.tool === 'dream';
    const detail = isDream ? describeDreamRun(row) : describeMock(row);
    const item: ContextItem = {
      id: row.id,
      kind: isDream ? 'dream_run' : 'mock_interview',
      label: row.input_summary ?? (isDream ? 'Dream Company' : 'Interview Lab'),
      detail,
      createdAt: row.created_at,
      // Runs from before migration 018 carry no input_json, so there is nothing
      // in them a pack could use beyond the raw output. Not worth defaulting on.
      recommended: detail !== null,
    };
    (isDream ? dreamRuns : mockInterviews).push(item);
  }

  return { dreamRuns, mockInterviews };
}

async function listCvAnalyses(studentId: string): Promise<ContextItem[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('cv_analysis_jobs')
    .select('id, status, input_json, updated_at')
    .eq('user_id', studentId)
    .eq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error) {
    throw Object.assign(new Error('Could not load the student CV analyses'), {
      statusCode: 500,
      cause: error,
    });
  }

  return (data ?? []).map((row) => {
    const input = (row.input_json ?? {}) as Record<string, unknown>;
    const role = typeof input.targetRole === 'string' ? input.targetRole : null;
    const hadJd = typeof input.jobDescription === 'string' && input.jobDescription.trim().length > 0;
    return {
      id: row.id as string,
      kind: 'cv_analysis' as const,
      label: role ? `CV Optimiser · ${role}` : 'CV Optimiser',
      detail: hadJd ? 'analysed against a JD' : role ? 'analysed against a target role' : null,
      createdAt: row.updated_at as string,
      // Without input_json (pre-018 rows) there is no way to say what this
      // analysed, which makes it a poor default even though it exists.
      recommended: role !== null,
    };
  });
}

/**
 * Everything this student has produced, ready to be ticked.
 *
 * Each source is queried independently and the whole call fails if any does —
 * unlike the research pipeline, a half-built picker would silently hide options
 * the student has, and they would never know to ask why.
 */
export async function listStudentContext(studentId: string): Promise<StudentContextInventory> {
  const [cvs, runs, cvAnalyses] = await Promise.all([
    listCvs(studentId),
    listToolRuns(studentId),
    listCvAnalyses(studentId),
  ]);

  return {
    studentId,
    cvs,
    dreamRuns: runs.dreamRuns,
    mockInterviews: runs.mockInterviews,
    cvAnalyses: cvAnalyses,
  };
}

// ── Readiness (pure — unit-tested) ──────────────────────────────────────────

export interface ReadinessInput {
  inventory: StudentContextInventory;
  /** The JD the student pasted at booking. */
  jdText?: string;
  /** Whether they gave the company's website. */
  companyUrl?: string;
  /** From the company research (T3). Undefined when it has not run yet. */
  companySparse?: boolean;
  /** Which interview round. */
  stage?: string;
  interviewerRole?: string;
  /** "What worries you most" — the cheapest high-value input in the form. */
  worryText?: string;
}

/** Weights sum to 100. CV and JD dominate because nothing works without them. */
const WEIGHTS = { cv: 30, jd: 25, company: 20, history: 15, details: 10 } as const;

export function assessContextReadiness(input: ReadinessInput): ContextReport {
  const { inventory, jdText, companyUrl, companySparse, stage, interviewerRole, worryText } = input;
  const gaps: ContextGap[] = [];
  let score = 0;

  // ── CV ──
  const parsedCv = inventory.cvs.find((c) => c.detail?.includes('bullets'));
  const anyCv = inventory.cvs[0];
  let cvSignal: ContextReport['signals']['cv'];
  if (!anyCv) {
    cvSignal = 'missing';
    gaps.push({
      id: 'cv-missing',
      severity: 'blocking',
      label: 'This student has no CV on file.',
      action: 'Ask them to upload one, or paste their CV in the Context Desk.',
    });
  } else if (!parsedCv) {
    cvSignal = 'raw_only';
    score += WEIGHTS.cv * 0.6;
    gaps.push({
      id: 'cv-not-parsed',
      severity: 'important',
      label: 'Their CV is raw text — it has never been parsed into bullets.',
      action: 'Run it through the CV Library so the pack can quote specific achievements.',
    });
  } else {
    cvSignal = 'good';
    score += WEIGHTS.cv;
  }

  // ── JD ──
  const jd = jdText?.trim() ?? '';
  let jdSignal: ContextReport['signals']['jd'];
  if (jd.length < JD_MISSING_CHARS) {
    jdSignal = 'missing';
    gaps.push({
      id: 'jd-missing',
      severity: 'blocking',
      label: 'There is no usable job description.',
      action: 'Paste the full advert, or the URL it came from.',
    });
  } else if (jd.length < JD_THIN_CHARS) {
    jdSignal = 'thin';
    score += WEIGHTS.jd * 0.5;
    gaps.push({
      id: 'jd-thin',
      severity: 'important',
      label: `The job description is only ${jd.length} characters — too short to align a CV against.`,
      action: 'Paste the full advert including responsibilities and requirements.',
    });
  } else {
    jdSignal = 'good';
    score += WEIGHTS.jd;
  }

  // ── Company ──
  let companySignal: ContextReport['signals']['company'];
  if (companySparse === undefined) {
    companySignal = 'missing';
    // Not a gap the coach can fix — research simply has not run yet.
  } else if (companySparse) {
    companySignal = 'sparse';
    score += WEIGHTS.company * 0.3;
    gaps.push({
      id: 'company-sparse',
      severity: 'important',
      label: 'Little could be found about the company.',
      action: companyUrl?.trim()
        ? 'Attach more pages — their careers page, a recent article, a founder interview.'
        : 'Add the company website, then any careers or news page you know of.',
    });
  } else {
    companySignal = 'good';
    score += WEIGHTS.company;
  }

  // ── What we know about the student beyond their CV ──
  const signals =
    inventory.dreamRuns.filter((r) => r.recommended).length +
    inventory.mockInterviews.filter((r) => r.recommended).length +
    inventory.cvAnalyses.filter((r) => r.recommended).length;
  let historySignal: ContextReport['signals']['studentHistory'];
  if (signals === 0) {
    historySignal = 'none';
    gaps.push({
      id: 'history-none',
      severity: 'nice_to_have',
      label: 'This student has not used the other tools, so nothing is known about how they perform.',
      action: 'Ask them to run a mock interview first, or note their weak points yourself below.',
    });
  } else if (signals < 2) {
    historySignal = 'partial';
    score += WEIGHTS.history * 0.5;
  } else {
    historySignal = 'rich';
    score += WEIGHTS.history;
  }

  // ── The interview itself ──
  const detailCount = [stage?.trim(), interviewerRole?.trim(), worryText?.trim()].filter(Boolean).length;
  let detailSignal: ContextReport['signals']['interviewDetails'];
  if (detailCount === 0) {
    detailSignal = 'missing';
    gaps.push({
      id: 'interview-details-missing',
      severity: 'important',
      label: 'We do not know which round this is or who is running it.',
      action: 'Questions are chosen by round and interviewer — fill these in before generating.',
    });
  } else if (detailCount < 3) {
    detailSignal = 'partial';
    score += WEIGHTS.details * 0.5;
    if (!worryText?.trim()) {
      gaps.push({
        id: 'worry-missing',
        severity: 'nice_to_have',
        label: 'The student did not say what worries them most.',
        action: 'Ask them — it is the single line that most often decides where the hour goes.',
      });
    }
  } else {
    detailSignal = 'good';
    score += WEIGHTS.details;
  }

  // ── Verdict ──
  // Blocking gaps are absolute: no CV or no JD means the pack has nothing to be
  // about, and generating would burn four LLM calls to produce filler.
  const hasBlocking = gaps.some((g) => g.severity === 'blocking');
  const hasImportant = gaps.some((g) => g.severity === 'important');
  const verdict: ContextReadinessVerdict = hasBlocking
    ? 'blocked'
    : hasImportant
      ? 'needs_coach'
      : 'ready';

  return {
    verdict,
    score: Math.round(score),
    gaps,
    signals: {
      cv: cvSignal,
      jd: jdSignal,
      company: companySignal,
      studentHistory: historySignal,
      interviewDetails: detailSignal,
    },
    generatedAt: new Date().toISOString(),
  };
}
