/**
 * buildLlmAnalysisV2 — dormant end-to-end orchestrator for the CV Optimizer
 * agent architecture (step 5b).
 *
 * Architectural proof only: it assembles a complete AnalyzeCvResult from the
 * four dormant agents plus the existing (now exported) buildAtsCheck,
 * computeCompositeScore, and generateActionPlan — WITHOUT normalizeResult (the
 * agents own normalization) and WITHOUT touching the live monolith path.
 *
 * Reliability now mirrors the monolith: a no-LLM short-circuit returns
 * buildFallbackAnalysis() before any work, the four agents and the ATS pipeline
 * fan out in PARALLEL via Promise.all (each isolated by its own fallback), then
 * computeCompositeScore (sync) and generateActionPlan run sequentially with the
 * action plan isolated to buildActionPlanFallback(). It never throws. Remaining
 * non-reliability gaps vs buildLlmAnalysis(): NO model routing, and split-prompt
 * output that still needs quality evaluation. Nothing imports this; it is fully
 * dormant.
 */
import { analyzeStructure } from './structure.agent.js';
import { extractKeywords } from './keywords.agent.js';
import { analyzeBullets } from './bullets.agent.js';
import { analyzeAlignment } from './alignment.agent.js';
import { fallbackStructure, fallbackKeywords, fallbackBullets, fallbackAlignment } from './fallbacks.js';
import {
  buildAtsCheck,
  computeCompositeScore,
  generateActionPlan,
  buildActionPlanFallback,
  buildFallbackAnalysis,
} from '../cv-optimizer.service.js';
import { getLlmConfig } from '../../config/llm.js';
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

  // No-LLM short-circuit — mirror analyzeCv(): if the LLM is disabled, return the
  // local fallback analysis without running any agent, ATS, action-plan, or
  // Promise.all work.
  if (!getLlmConfig('cvOptimizer').enabled) {
    return buildFallbackAnalysis({ targetRole, currentCvText: cvText, jobDescription });
  }

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

  // 7: action plan over the full evaluation context, isolated to the monolith's
  // fallback (mirrors buildLlmAnalysis()).
  const actionPlan = await generateActionPlan({
    targetRole,
    jobDescription,
    sections: structure.sections,
    atsCheck,
    bulletEvaluations: bullets.bulletEvaluations,
    jdAlignment: alignment.jdAlignment,
    keywordHighlights: keywords.keywordHighlights,
  }).catch(() => buildActionPlanFallback());

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
