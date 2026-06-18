/**
 * buildLlmAnalysisV2 — dormant end-to-end orchestrator for the CV Optimizer
 * agent architecture (step 5b).
 *
 * Architectural proof only: it assembles a complete AnalyzeCvResult from the
 * four dormant agents plus the existing (now exported) buildAtsCheck,
 * computeCompositeScore, and generateActionPlan — WITHOUT normalizeResult (the
 * agents own normalization) and WITHOUT touching the live monolith path.
 *
 * Intentionally NOT production-ready. It runs the agents SEQUENTIALLY (no
 * Promise.all), with NO model routing, and only the four agents get per-agent
 * fallbacks — buildAtsCheck() and generateActionPlan() are called bare so the
 * remaining gaps vs buildLlmAnalysis() stay visible (ATS/action-plan failures
 * reject; no no-LLM short-circuit). Nothing imports this; it is fully dormant.
 */
import { analyzeStructure } from './structure.agent.js';
import { extractKeywords } from './keywords.agent.js';
import { analyzeBullets } from './bullets.agent.js';
import { analyzeAlignment } from './alignment.agent.js';
import { fallbackStructure, fallbackKeywords, fallbackBullets, fallbackAlignment } from './fallbacks.js';
import { buildAtsCheck, computeCompositeScore, generateActionPlan } from '../cv-optimizer.service.js';
import type { AnalyzeCvResult } from '@advance-academy/contracts/cv-optimizer';

export type BuildLlmAnalysisV2Input = {
  targetRole: string;
  cvText: string;
  jobDescription?: string;
};

export async function buildLlmAnalysisV2(input: BuildLlmAnalysisV2Input): Promise<AnalyzeCvResult> {
  const { targetRole, cvText, jobDescription } = input;

  // 1–4: the four agents, each degrading independently to its contract-safe fallback.
  const structure = await analyzeStructure({ targetRole, cvText, jobDescription }).catch(fallbackStructure);
  const keywords = await extractKeywords({ targetRole, cvText, jobDescription }).catch(fallbackKeywords);
  const bullets = await analyzeBullets({ targetRole, cvText }).catch(fallbackBullets);
  const alignment = jobDescription
    ? await analyzeAlignment({ targetRole, cvText, jobDescription }).catch(fallbackAlignment)
    : fallbackAlignment();

  // 5: ATS pipeline (bare — no fallback yet, by design for step 5b).
  const atsCheck = await buildAtsCheck({ targetRole, currentCvText: cvText, jobDescription });

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
