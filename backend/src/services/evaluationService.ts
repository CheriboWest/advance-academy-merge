/**
 * Evaluation service — dual-persona qualitative feedback (recruiter + expert).
 * Runs two Claude calls in parallel and merges top strengths/weaknesses.
 */
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import type { ScoringResult } from '../lib/rubric.js';
import type { ParsedCV, ParsedJD } from '../types/cv-optimizer.js';

// ─── Exported interfaces ───────────────────────────────────────────────────────

export interface Strength {
  area: string;      // e.g. "Technical skills", "Leadership"
  evidence: string;  // specific bullet or phrase from the CV
  impact: string;    // why this matters for the role
}

export interface Weakness {
  area: string;        // e.g. "Missing metrics", "Seniority gap"
  detail: string;      // specific problem found in the CV
  suggestion: string;  // concrete fix
}

export interface PersonaFeedback {
  persona: 'recruiter' | 'expert';
  strengths: Strength[];
  weaknesses: Weakness[];
  verdict: string;   // two sentences max
}

export interface EvaluationResult {
  recruiterFeedback: PersonaFeedback;
  expertFeedback: PersonaFeedback;
  topStrengths: Strength[];   // top 3, deduplicated across personas
  topWeaknesses: Weakness[];  // top 3, deduplicated across personas
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripJsonFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function buildContextBlock(
  parsedCV: ParsedCV,
  parsedJD: ParsedJD,
  scoringResult: ScoringResult,
): string {
  const rubricSummary = scoringResult.rubricScores
    .map((s) => `  ${s.dimension}: ${s.score}/10 — ${s.reasoning}`)
    .join('\n');

  return [
    '=== CV ===',
    parsedCV.fullText,
    '',
    '=== JOB DESCRIPTION ===',
    parsedJD.fullText,
    '',
    '=== MATCHED KEYWORDS ===',
    scoringResult.matchedKeywords.join(', ') || 'None',
    '',
    '=== MISSING KEYWORDS ===',
    scoringResult.missingKeywords.join(', ') || 'None',
    '',
    '=== RUBRIC SCORES ===',
    rubricSummary,
  ].join('\n');
}

const PERSONA_FEEDBACK_SCHEMA = `{
  "persona": "recruiter" | "expert",
  "strengths": [{ "area": string, "evidence": string, "impact": string }],
  "weaknesses": [{ "area": string, "detail": string, "suggestion": string }],
  "verdict": string
}`;

function validatePersonaFeedback(raw: unknown, persona: 'recruiter' | 'expert'): PersonaFeedback {
  const obj = raw as Record<string, unknown>;

  if (
    !Array.isArray(obj.strengths) ||
    !Array.isArray(obj.weaknesses) ||
    typeof obj.verdict !== 'string'
  ) {
    throw new Error(`Evaluation service (${persona}): response missing required fields.`);
  }

  if (obj.strengths.length < 2 || obj.strengths.length > 4) {
    throw new Error(`Evaluation service (${persona}): expected 2–4 strengths, got ${obj.strengths.length}.`);
  }

  if (obj.weaknesses.length < 2 || obj.weaknesses.length > 4) {
    throw new Error(`Evaluation service (${persona}): expected 2–4 weaknesses, got ${obj.weaknesses.length}.`);
  }

  return {
    persona,
    strengths: obj.strengths as Strength[],
    weaknesses: obj.weaknesses as Weakness[],
    verdict: obj.verdict as string,
  };
}

function mergeTop3<T extends { area: string; evidence?: string }>(
  a: T[],
  b: T[],
  evidenceKey: keyof T,
): T[] {
  const seen = new Map<string, T>();

  for (const item of [...a, ...b]) {
    const key = item.area.toLowerCase();
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, item);
    } else {
      // Prefer the item with more specific evidence
      const existingEvidence = String(existing[evidenceKey] ?? '');
      const newEvidence = String(item[evidenceKey] ?? '');
      if (newEvidence.length > existingEvidence.length) {
        seen.set(key, item);
      }
    }
  }

  return Array.from(seen.values()).slice(0, 3);
}

async function callPersona(
  persona: 'recruiter' | 'expert',
  contextBlock: string,
  anthropic: ReturnType<typeof createAnthropicClient>,
  model: string,
): Promise<PersonaFeedback> {
  const systemPrompts: Record<'recruiter' | 'expert', string> = {
    recruiter: [
      'You are a senior UK recruiter with 10 years experience. You screen CVs in under 10 seconds.',
      'You care about: clarity of career story, visibility of impact and ROI, skimmability,',
      'and whether the candidate\'s value is immediately obvious to a non-technical reader.',
      'You do not evaluate technical depth.',
      'Evaluate the CV against the JD and return ONLY valid JSON matching the PersonaFeedback schema.',
      'No markdown. No preamble. Strengths and weaknesses must each contain 2–4 items.',
      'Each strength needs evidence from the actual CV text. Each weakness needs a concrete suggestion.',
    ].join(' '),
    expert: [
      'You are a senior industry professional reviewing this CV for technical and professional credibility.',
      'You care about: depth of experience, believability of claimed skills, proof of real ownership,',
      'and whether the candidate demonstrates genuine domain expertise versus surface-level buzzwords.',
      'Evaluate the CV against the JD and return ONLY valid JSON matching the PersonaFeedback schema.',
      'No markdown. No preamble. Strengths and weaknesses must each contain 2–4 items.',
      'Each strength needs evidence from the actual CV text. Each weakness needs a concrete suggestion.',
    ].join(' '),
  };

  const userPrompt = [
    contextBlock,
    '',
    '=== EXPECTED JSON SCHEMA ===',
    PERSONA_FEEDBACK_SCHEMA,
    '',
    `Return your evaluation as the ${persona} persona now. JSON only.`,
  ].join('\n');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: systemPrompts[persona],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error(`Evaluation service (${persona}): Claude response was not a text block.`);
  }

  const parsed = JSON.parse(stripJsonFences(block.text)) as unknown;
  return validatePersonaFeedback(parsed, persona);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function evaluateCV(
  parsedCV: ParsedCV,
  parsedJD: ParsedJD,
  scoringResult: ScoringResult,
): Promise<EvaluationResult> {
  assertLlmConfigured('cvOptimizer');

  const anthropic = createAnthropicClient();
  const model = getFeatureModel('cvOptimizer');
  const contextBlock = buildContextBlock(parsedCV, parsedJD, scoringResult);

  let recruiterFeedback: PersonaFeedback;
  let expertFeedback: PersonaFeedback;

  try {
    [recruiterFeedback, expertFeedback] = await Promise.all([
      callPersona('recruiter', contextBlock, anthropic, model),
      callPersona('expert', contextBlock, anthropic, model),
    ]);
  } catch (error) {
    throw new Error(
      `Evaluation service failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const topStrengths = mergeTop3<Strength>(
    recruiterFeedback.strengths,
    expertFeedback.strengths,
    'evidence',
  );

  const topWeaknesses = mergeTop3<Weakness>(
    recruiterFeedback.weaknesses,
    expertFeedback.weaknesses,
    'detail',
  );

  return {
    recruiterFeedback,
    expertFeedback,
    topStrengths,
    topWeaknesses,
  };
}
