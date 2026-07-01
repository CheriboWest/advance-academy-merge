/**
 * Contract-safe fallbacks for the dormant CV Optimizer agents.
 *
 * One pure fallback per agent, returning the agent's narrow Out shape with
 * empty/neutral defaults. These are the per-agent failure substitutes the
 * future parallel orchestrator will use (e.g. analyzeStructure(input).catch(
 * fallbackStructure)) so one agent's failure does not collapse the whole result.
 *
 * Pure: no logging, no retries, no throws, empty arrays (never null). Not wired
 * into any live path — nothing imports these yet.
 */
import type { StructureOut } from './structure.agent.js';
import type { KeywordsOut } from './keywords.agent.js';
import type { BulletsOut } from './bullets.agent.js';
import type { AlignmentOut } from './alignment.agent.js';

export function fallbackStructure(): StructureOut {
  return {
    sections: [],
    formatCheck: {
      issues: [],
      suggestions: ['Structure analysis unavailable this run.'],
    },
  };
}

export function fallbackKeywords(): KeywordsOut {
  return {
    keywordHighlights: [],
  };
}

export function fallbackBullets(): BulletsOut {
  return {
    bulletEvaluations: [],
    rewriteSuggestions: [],
  };
}

export function fallbackAlignment(): AlignmentOut {
  return {
    jdAlignment: {
      matchedRequirements: [],
      missingRequirements: [],
      alignmentSummary: '',
    },
  };
}
