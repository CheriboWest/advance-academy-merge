/**
 * Cost tracker for LLM (Anthropic) and Exa calls.
 * Logs per-call usage + cost to the backend console, and supports
 * accumulating a per-request total via newCostBucket().
 *
 * Pricing is defined in this file — keep it in sync with provider price cards.
 *  - Anthropic Sonnet 4:  $3 / MTok input,  $15 / MTok output
 *  - Anthropic Opus 4:    $15 / MTok input, $75 / MTok output
 *  - Anthropic Haiku 4.5: $1 / MTok input,  $5 / MTok output
 *  - Exa fast search + contents: ~$5 / 1000 calls
 */

interface ModelPricing {
  /** USD per 1,000,000 input tokens */
  input: number;
  /** USD per 1,000,000 output tokens */
  output: number;
  /** USD per 1,000,000 cache-write tokens (defaults to 1.25× input) */
  cacheWrite?: number;
  /** USD per 1,000,000 cache-read tokens (defaults to 0.10× input) */
  cacheRead?: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Sonnet 4 family (default)
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  // Opus 4 family
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-opus-4-6': { input: 15, output: 75 },
  // Haiku 4 family
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

/** Conservative fallback when an unknown model name is reported. */
const FALLBACK_PRICING: ModelPricing = { input: 3, output: 15 };

/** Exa fast searchAndContents — public price card is ~$5 per 1k calls. */
const EXA_COST_PER_SEARCH_USD = 0.005;

export interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function pricingFor(model: string): ModelPricing {
  return PRICING[model] ?? FALLBACK_PRICING;
}

function fmtUsd(amount: number): string {
  return `$${amount.toFixed(5)}`;
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' ? value : 0;
}

export function calcLlmCost(model: string, usage: AnthropicUsage): number {
  const p = pricingFor(model);
  const inputCost = (num(usage.input_tokens) * p.input) / 1_000_000;
  const outputCost = (num(usage.output_tokens) * p.output) / 1_000_000;
  const cacheWriteCost =
    (num(usage.cache_creation_input_tokens) * (p.cacheWrite ?? p.input * 1.25)) / 1_000_000;
  const cacheReadCost =
    (num(usage.cache_read_input_tokens) * (p.cacheRead ?? p.input * 0.1)) / 1_000_000;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

export function calcExaCost(numSearches: number): number {
  return numSearches * EXA_COST_PER_SEARCH_USD;
}

/** A bucket that collects costs incurred during a single request. */
export interface CostBucket {
  /** Track an LLM call and log it. Returns the cost in USD. */
  llm(label: string, model: string, usage: AnthropicUsage | undefined | null): number;
  /** Track Exa searches and log them. Returns the cost in USD. */
  exa(label: string, numSearches: number): number;
  /** Print the accumulated total for the request. */
  flush(): number;
  /** Current accumulated total (without printing). */
  total(): number;
}

export function newCostBucket(requestLabel: string): CostBucket {
  let runningTotal = 0;

  return {
    llm(label, model, usage) {
      const u: AnthropicUsage = usage ?? {};
      const cost = calcLlmCost(model, u);
      runningTotal += cost;
      // eslint-disable-next-line no-console
      console.log(
        `[cost] ${requestLabel} :: ${label.padEnd(22)} model=${model} ` +
          `in=${num(u.input_tokens)} out=${num(u.output_tokens)} cost=${fmtUsd(cost)}`,
      );
      return cost;
    },
    exa(label, numSearches) {
      const cost = calcExaCost(numSearches);
      runningTotal += cost;
      // eslint-disable-next-line no-console
      console.log(
        `[cost] ${requestLabel} :: ${label.padEnd(22)} provider=exa searches=${numSearches} cost=${fmtUsd(cost)}`,
      );
      return cost;
    },
    flush() {
      // eslint-disable-next-line no-console
      console.log(`[cost] ${requestLabel} :: TOTAL                 cost=${fmtUsd(runningTotal)}`);
      return runningTotal;
    },
    total() {
      return runningTotal;
    },
  };
}
