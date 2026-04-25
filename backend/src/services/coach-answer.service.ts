/**
 * Coach-answer service: rewrites a candidate's interview answer using only
 * grounded evidence (CV bullets + attached artifacts), emitting placeholders
 * for missing facts.
 */
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import { buildCoachAnswerPrompt, type CoachEvidenceBlock } from '../lib/cv-knowledge/prompts.js';
import {
  getArtifactsForBullets,
  getRelevantBulletsForQuestion,
} from './cv-knowledge.service.js';
import type { CoachAnswerRequest, CoachAnswerResponse, MissingEvidencePrompt } from '../types/cv-knowledge.js';
import { getSupabase } from '../lib/supabase.js';

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

export async function coachAnswer(req: CoachAnswerRequest, userId: string): Promise<CoachAnswerResponse> {
  if (!req.question?.trim() || !req.answer?.trim()) {
    throw Object.assign(new Error('question and answer are required'), { statusCode: 400 });
  }

  // Pull bullets from the user's ENTIRE pool (not just one CV version).
  // This is the key fix: evidence from all CV versions is now accessible.
  let cvBullets: Array<{ id: string; section: string | null; text: string }> = [];
  let evidence: CoachEvidenceBlock[] = [];

  {
    const supabase = getSupabase();
    const { data: allBullets } = await supabase
      .from('cv_bullets')
      .select('id, section_path, bullet_text')
      .eq('user_id', userId)
      .order('ordinal', { ascending: true });
    cvBullets = (allBullets ?? []).map((b) => ({
      id: b.id,
      section: b.section_path,
      text: b.bullet_text,
    }));

    // cvVersionId is still passed for backward compat but getRelevantBulletsForQuestion
    // now queries by user_id internally.
    const cvVersionId = req.cvVersionId ?? null;
    const relevant = await getRelevantBulletsForQuestion(cvVersionId ?? '', req.question, userId);
    if (relevant.length > 0) {
      const artifactMap = await getArtifactsForBullets(relevant.map((b) => b.id));
      evidence = relevant.map((b) => ({
        bulletId: b.id,
        bulletText: b.bullet_text,
        section: b.section_path,
        artifacts: (artifactMap.get(b.id) ?? []).map((a) => ({
          overview: a.overview,
          my_contribution: a.my_contribution,
          concrete_facts: a.concrete_facts ?? [],
          metrics: a.metrics ?? [],
        })),
      }));
    }
  }

  const { system, user } = buildCoachAnswerPrompt({
    question: req.question,
    answer: req.answer,
    jobTitle: req.context.jobTitle,
    jobDescription: req.context.jobDescription,
    companyName: req.context.companyName,
    cvBullets: cvBullets.map((b) => ({ section: b.section, text: b.text })),
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
  // Prefer prompts the LLM listed; if it forgot, scan the placeholders directly.
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

  // Decorate prompts with bullet text for nicer UI
  const bulletById = new Map(cvBullets.map((b) => [b.id, b.text]));
  prompts = prompts.map((p) => ({
    ...p,
    bulletText: p.bulletId ? bulletById.get(p.bulletId) ?? null : null,
  }));

  return {
    critique: parsed.critique ?? '',
    improvedAnswer: improved,
    missingEvidencePrompts: prompts,
  };
}
