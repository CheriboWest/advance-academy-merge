/**
 * buildLlmAnalysisV2 — dormant end-to-end orchestrator for the CV Optimizer
 * agent architecture (step 5b).
 *
 * Architectural proof only: it assembles a complete AnalyzeCvResult from the
 * four dormant agents plus the existing (now exported) buildAtsCheck,
 * computeCompositeScore, and generateActionPlan — WITHOUT normalizeResult (the
 * agents own normalization) and WITHOUT touching the live monolith path.
 *
 * Intentionally NOT production-ready. The four agents and the ATS pipeline run
 * in PARALLEL via Promise.all (each isolated by its own fallback), then
 * computeCompositeScore and generateActionPlan run sequentially. NO model
 * routing. generateActionPlan() is still called bare, so the remaining gaps vs
 * buildLlmAnalysis() stay visible (action-plan failure rejects; no no-LLM
 * short-circuit). Nothing imports this; it is fully dormant.
 */
import { analyzeStructure } from './structure.agent.js';
import { extractKeywords } from './keywords.agent.js';
import { analyzeBullets } from './bullets.agent.js';
import { analyzeAlignment } from './alignment.agent.js';
import { fallbackStructure, fallbackKeywords, fallbackBullets, fallbackAlignment } from './fallbacks.js';
import { buildAtsCheck, computeCompositeScore, generateActionPlan } from '../cv-optimizer.service.js';
import type { AnalyzeCvResult, AtsCheck } from '@advance-academy/contracts/cv-optimizer';

export type BuildLlmAnalysisV2Input = {
  targetRole: string;
  cvText: string;
  jobDescription?: string;
};

// Matches the inline ATS fallback in buildLlmAnalysis() exactly — preserves
// monolith behavior when the ATS pipeline fails.
const EMPTY_ATS_CHECK: AtsCheck = {
  score: 0,
  issues: ['ATS scoring pipeline failed — score unavailable.'],
  passed: [],
  extractedKeywords: [],
  relevanceSignals: [],
};

export async function buildLlmAnalysisV2(input: BuildLlmAnalysisV2Input): Promise<AnalyzeCvResult> {
  const { targetRole, cvText, jobDescription } = input;

  // 1–5: fan out the four agents + the ATS pipeline in parallel. Each branch
  // carries its own fallback, so every promise resolves and Promise.all never
  // rejects — per-branch isolation is preserved.
  const structurePromise = analyzeStructure({ targetRole, cvText, jobDescription }).catch(fallbackStructure);
  const keywordsPromise = extractKeywords({ targetRole, cvText, jobDescription }).catch(fallbackKeywords);
  const bulletsPromise = analyzeBullets({ targetRole, cvText }).catch(fallbackBullets);
  const atsPromise = buildAtsCheck({ targetRole, currentCvText: cvText, jobDescription }).catch(() => EMPTY_ATS_CHECK);
  const alignmentPromise = jobDescription
    ? analyzeAlignment({ targetRole, cvText, jobDescription }).catch(fallbackAlignment)
    : Promise.resolve(fallbackAlignment());

  const [structure, keywords, bullets, atsCheck, alignment] = await Promise.all([
    structurePromise,
    keywordsPromise,
    bulletsPromise,
    atsPromise,
    alignmentPromise,
  ]);

  // 6: composite score from agent + ATS outputs.
  const { overallScore, breakdown } = computeCompositeScore(
    structure.sections,
    atsCheck,
    bullets.bulletEvaluations,
  );

  // 7: action plan over the full evaluation context (bare — no fallback yet, by design).
  const actionPlan = await generateActionPlan({
    targetRole,
    jobDescription,
    sections: structure.sections,
    atsCheck,
    bulletEvaluations: bullets.bulletEvaluations,
    jdAlignment: alignment.jdAlignment,
    keywordHighlights: keywords.keywordHighlights,
  });

  // 8: assemble the contract result (same field set/names as buildLlmAnalysis).
  return {
    overallScore,
    scoreBreakdown: breakdown,
    sections: structure.sections,
    keywordHighlights: keywords.keywordHighlights,
    atsCheck,
    formatCheck: structure.formatCheck,
    bulletEvaluations: bullets.bulletEvaluations,
    rewriteSuggestions: bullets.rewriteSuggestions,
    jdAlignment: alignment.jdAlignment,
    actionPlan,
  };
}
