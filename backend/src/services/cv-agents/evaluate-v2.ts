/**
 * evaluate-v2.ts — dormant measurement harness comparing buildLlmAnalysis()
 * (monolith) against buildLlmAnalysisV2() on identical inputs.
 *
 * Measurement only: deterministic count/score deltas, structural booleans, and
 * approximate wall-clock timings. No LLM-as-judge, no embeddings, no semantic
 * scoring. Goal: surface differences, not declare a winner. Nothing imports
 * this; it is fully dormant.
 *
 * Run with the LLM configured. buildLlmAnalysis() is the raw monolith core and
 * can return null on truncation/no-text; when it does, the sample is reported
 * as comparable:false (deltas NaN) rather than throwing — a null is itself
 * useful evaluation information and must not abort a batch. (The monolith can
 * also throw on an LLM error; that propagates — a batch runner should try/catch
 * each sample. V2 never throws.)
 */
import { buildLlmAnalysis } from '../cv-optimizer.service.js';
import { buildLlmAnalysisV2 } from './build-llm-analysis-v2.js';
import type { AnalyzeCvResult } from '@advance-academy/contracts/cv-optimizer';

export type EvaluateV2Input = {
  targetRole: string;
  cvText: string;
  jobDescription?: string;
};

export type EvaluateV2Result = {
  monolith: AnalyzeCvResult | null;
  v2: AnalyzeCvResult;
  comparable: boolean;
  runtimeMs: { monolith: number; v2: number };
  metrics: {
    overallScoreDelta: number;          // monolith - v2 (positive ⇒ monolith higher)
    sectionCountDelta: number;
    bulletCountDelta: number;
    keywordCountDelta: number;
    atsScoreDelta: number;
    sectionTitlesMatch: boolean;        // ordered exact title match
    formatIssueCountDelta: number;
    rewriteSuggestionCountDelta: number;
    actionPlanItemCountDelta: number;
  };
};

const NOT_COMPARABLE_METRICS: EvaluateV2Result['metrics'] = {
  overallScoreDelta: NaN,
  sectionCountDelta: NaN,
  bulletCountDelta: NaN,
  keywordCountDelta: NaN,
  atsScoreDelta: NaN,
  sectionTitlesMatch: false,
  formatIssueCountDelta: NaN,
  rewriteSuggestionCountDelta: NaN,
  actionPlanItemCountDelta: NaN,
};

function actionPlanItemCount(r: AnalyzeCvResult): number {
  const p = r.actionPlan;
  return (
    p.projectsToBuild.length +
    p.skillsToLearn.length +
    p.certifications.length +
    p.intermediateRoles.length
  );
}

function orderedTitlesMatch(a: AnalyzeCvResult, b: AnalyzeCvResult): boolean {
  const ta = a.sections.map((s) => s.title);
  const tb = b.sections.map((s) => s.title);
  return ta.length === tb.length && ta.every((t, i) => t === tb[i]);
}

export async function evaluateV2(input: EvaluateV2Input): Promise<EvaluateV2Result> {
  const { targetRole, cvText, jobDescription } = input;

  // Run both concurrently; capture each one's own wall-clock from kickoff to
  // resolution. NOTE: concurrent execution means the two contend for the same
  // rate-limit/network budget, so these timings are co-measurements, not
  // isolated per-implementation latency.
  const monolithStart = Date.now();
  const monolithPromise = buildLlmAnalysis({ targetRole, currentCvText: cvText, jobDescription })
    .then((result) => ({ result, ms: Date.now() - monolithStart }));

  const v2Start = Date.now();
  const v2Promise = buildLlmAnalysisV2({ targetRole, cvText, jobDescription })
    .then((result) => ({ result, ms: Date.now() - v2Start }));

  const [monolithTimed, v2Timed] = await Promise.all([monolithPromise, v2Promise]);

  const monolithResult = monolithTimed.result;
  const v2 = v2Timed.result;
  const runtimeMs = { monolith: monolithTimed.ms, v2: v2Timed.ms };

  // Monolith returned null (truncation/no-text): record as not comparable rather
  // than throwing — a single sample must not abort the batch.
  if (monolithResult === null) {
    return { monolith: null, v2, comparable: false, runtimeMs, metrics: { ...NOT_COMPARABLE_METRICS } };
  }
  const monolith = monolithResult;

  const metrics: EvaluateV2Result['metrics'] = {
    overallScoreDelta: monolith.overallScore - v2.overallScore,
    sectionCountDelta: monolith.sections.length - v2.sections.length,
    bulletCountDelta: monolith.bulletEvaluations.length - v2.bulletEvaluations.length,
    keywordCountDelta: monolith.keywordHighlights.length - v2.keywordHighlights.length,
    atsScoreDelta: monolith.atsCheck.score - v2.atsCheck.score,
    sectionTitlesMatch: orderedTitlesMatch(monolith, v2),
    formatIssueCountDelta: monolith.formatCheck.issues.length - v2.formatCheck.issues.length,
    rewriteSuggestionCountDelta: monolith.rewriteSuggestions.length - v2.rewriteSuggestions.length,
    actionPlanItemCountDelta: actionPlanItemCount(monolith) - actionPlanItemCount(v2),
  };

  return { monolith, v2, comparable: true, runtimeMs, metrics };
}
