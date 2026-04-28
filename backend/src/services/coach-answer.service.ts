/**
 * Coach-answer service: rewrites a candidate's interview answer using only
 * grounded evidence (CV bullets + attached artifacts), emitting placeholders
 * for missing facts.
 *
 * Two-phase flow:
 *   1. preview  — embedding retrieval over the user's bullet pool. Returns
 *                 the auto-preselected bullets (top-K above a similarity
 *                 threshold) along with their gaps + RAW artifact content,
 *                 so the user can review/edit the evidence before the LLM
 *                 call. No LLM tokens spent.
 *   2. generate — accepts the user's final bullet selection and runs the
 *                 rewriter LLM. Only artifact SUMMARIES are sent to the LLM
 *                 (raw content stays client-side for safety).
 */
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import { buildCoachAnswerPrompt, type CoachEvidenceBlock } from '../lib/cv-knowledge/prompts.js';
import {
  findRelevantBulletsForCoach,
  getBulletsWithGapsByIds,
  listUserBulletSummaries,
} from './cv-knowledge.service.js';
import type {
  ArtifactSummary,
  CoachAnswerResponse,
  CoachGenerateRequest,
  CoachPreviewBullet,
  CoachPreviewRequest,
  CoachPreviewResponse,
  MissingEvidencePrompt,
} from '../types/cv-knowledge.js';
import { getSupabase } from '../lib/supabase.js';
import { dbStoreCoaching } from '../lib/interview-prep/db.js';

// Tunables. Threshold is cosine similarity (1 = identical, 0 = orthogonal).
// 0.50 drops obviously-unrelated bullets without being so strict that
// paraphrased questions miss their match. Limit caps prompt size and what
// the user has to triage in the preview UI.
const COACH_SIMILARITY_THRESHOLD = 0.5;
const COACH_TOPK = 5;
// Conversation history sent to the LLM is capped to the most recent turns
// to keep the prompt bounded. Counts both interviewer and candidate messages,
// so 10 ≈ the last 5 Q&A pairs.
const COACH_HISTORY_TURNS = 10;

function cleanJson(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
}

const PLACEHOLDER_RE = /\[CANDIDATE TO FILL:\s*([^|\]]+)\|\s*([^\]]+)\]/g;

function extractPromptsFromText(improved: string): MissingEvidencePrompt[] {
  const out: MissingEvidencePrompt[] = [];
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(improved)) !== null) {
    const bulletId = m[1].trim();
    out.push({
      bulletId: bulletId === 'none' ? null : bulletId,
      bulletText: null,
      question: m[2].trim(),
    });
  }
  return out;
}

// ── Phase 1: preview ────────────────────────────────────────────────────────

export async function previewCoachAnswer(
  req: CoachPreviewRequest,
  userId: string,
): Promise<CoachPreviewResponse> {
  if (!req.question?.trim()) {
    throw Object.assign(new Error('question is required'), { statusCode: 400 });
  }

  const matched = await findRelevantBulletsForCoach(
    userId,
    req.question,
    COACH_SIMILARITY_THRESHOLD,
    COACH_TOPK,
  );
  const selectedBulletIds = matched.map((m) => m.bulletId);
  const similarityById = new Map(matched.map((m) => [m.bulletId, m.similarity] as const));

  const [bulletsWithGaps, allBullets] = await Promise.all([
    getBulletsWithGapsByIds(userId, selectedBulletIds),
    listUserBulletSummaries(userId),
  ]);

  const bullets: CoachPreviewBullet[] = bulletsWithGaps.map((b) => ({
    id: b.id,
    bulletText: b.bulletText,
    sectionPath: b.sectionPath,
    similarity: similarityById.get(b.id) ?? 0,
    gaps: b.gaps.map((g) => ({
      id: g.id,
      question: g.question,
      status: g.status,
      artifacts: g.artifacts.map((a) => ({
        id: a.id,
        sourceType: a.sourceType,
        contentText: a.contentText,
        sourceUrl: a.sourceUrl,
        createdAt: a.createdAt,
      })),
    })),
  }));

  return {
    selectedBulletIds,
    bullets,
    allBullets,
    threshold: COACH_SIMILARITY_THRESHOLD,
  };
}

// ── Phase 2: generate ───────────────────────────────────────────────────────

interface IrsRationaleRow {
  integrity?: string | null;
  relevance?: string | null;
  substance?: string | null;
}

async function loadIrsRationale(assessmentId: string): Promise<IrsRationaleRow | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('answer_assessments')
      .select('rationale_json')
      .eq('id', assessmentId)
      .maybeSingle();
    if (error || !data) return null;
    return (data.rationale_json as IrsRationaleRow | null) ?? null;
  } catch {
    return null;
  }
}

// Pull the LLM-friendly artifact summaries for a set of bullets, mapped by
// bullet id. Raw content is NOT included — only summary_json.
async function loadEvidenceSummaries(
  bulletIds: string[],
): Promise<Map<string, ArtifactSummary[]>> {
  const result = new Map<string, ArtifactSummary[]>();
  if (bulletIds.length === 0) return result;
  const supabase = getSupabase();

  const { data: gaps } = await supabase
    .from('bullet_gaps')
    .select('id, bullet_id')
    .in('bullet_id', bulletIds);
  const gapList = gaps ?? [];
  if (gapList.length === 0) return result;

  const gapToBullet = new Map<string, string>(gapList.map((g) => [g.id, g.bullet_id]));
  const { data: artifacts } = await supabase
    .from('bullet_artifacts')
    .select('gap_id, summary_json')
    .in(
      'gap_id',
      gapList.map((g) => g.id),
    );

  for (const a of artifacts ?? []) {
    if (!a.summary_json) continue;
    const bulletId = gapToBullet.get(a.gap_id);
    if (!bulletId) continue;
    const list = result.get(bulletId) ?? [];
    list.push(a.summary_json as ArtifactSummary);
    result.set(bulletId, list);
  }
  return result;
}

export async function generateCoachAnswer(
  req: CoachGenerateRequest,
  userId: string,
): Promise<CoachAnswerResponse> {
  if (!req.question?.trim() || !req.answer?.trim()) {
    throw Object.assign(new Error('question and answer are required'), { statusCode: 400 });
  }
  if (!req.context) {
    throw Object.assign(new Error('context is required'), { statusCode: 400 });
  }

  const selectedIds = Array.from(new Set((req.selectedBulletIds ?? []).filter((id) => id?.trim())));

  // Pull bullets the user chose (scoped by user) and build the evidence pool.
  const evidence: CoachEvidenceBlock[] = [];
  if (selectedIds.length > 0) {
    const [bullets, summariesByBullet] = await Promise.all([
      getBulletsWithGapsByIds(userId, selectedIds),
      loadEvidenceSummaries(selectedIds),
    ]);
    for (const b of bullets) {
      evidence.push({
        bulletId: b.id,
        bulletText: b.bulletText,
        section: b.sectionPath,
        artifacts: (summariesByBullet.get(b.id) ?? []).map((a) => ({
          overview: a.overview,
          my_contribution: a.my_contribution,
          concrete_facts: a.concrete_facts ?? [],
          metrics: a.metrics ?? [],
        })),
      });
    }
  }

  // Pull IRS rationale from the assessment row when we have an id.
  const irsRationale = req.assessmentId ? await loadIrsRationale(req.assessmentId) : null;

  const trimmedHistory = (req.conversationHistory ?? []).slice(-COACH_HISTORY_TURNS);

  const { system, user } = buildCoachAnswerPrompt({
    question: req.question,
    answer: req.answer,
    jobTitle: req.context.jobTitle,
    jobDescription: req.context.jobDescription,
    companyName: req.context.companyName,
    conversationHistory: trimmedHistory,
    irsScore: req.irsScore,
    irsRationale: irsRationale ?? undefined,
    evidence,
  });

  assertLlmConfigured('interviewPrep');
  const anthropic = createAnthropicClient('interviewPrep');
  const model = getFeatureModel('interviewPrep');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const block = response.content[0];
  if (!block || block.type !== 'text') {
    throw Object.assign(new Error('LLM returned no text'), { statusCode: 502 });
  }

  let parsed: {
    critique?: string;
    improvedAnswer?: string;
    missingEvidencePrompts?: Array<{ bulletId?: string | null; question?: string }>;
  };
  try {
    parsed = JSON.parse(cleanJson(block.text));
  } catch {
    throw Object.assign(new Error('Failed to parse coach LLM response'), { statusCode: 502 });
  }

  const improved = parsed.improvedAnswer?.trim() ?? '';
  let prompts: MissingEvidencePrompt[] = (parsed.missingEvidencePrompts ?? [])
    .filter((p) => p && p.question)
    .map((p) => ({
      bulletId: p.bulletId && p.bulletId !== 'none' ? p.bulletId : null,
      bulletText: null,
      question: p.question!,
    }));
  if (prompts.length === 0) {
    prompts = extractPromptsFromText(improved);
  }

  // Decorate prompts with bullet text for nicer UI labels.
  const bulletTextById = new Map(evidence.map((e) => [e.bulletId, e.bulletText]));
  prompts = prompts.map((p) => ({
    ...p,
    bulletText: p.bulletId ? bulletTextById.get(p.bulletId) ?? null : null,
  }));

  const result: CoachAnswerResponse = {
    critique: parsed.critique ?? '',
    improvedAnswer: improved,
    missingEvidencePrompts: prompts,
  };

  if (req.assessmentId) {
    await dbStoreCoaching(
      req.assessmentId,
      req.answer,
      result.critique,
      result.improvedAnswer,
      result.missingEvidencePrompts,
    );
  }

  return result;
}
