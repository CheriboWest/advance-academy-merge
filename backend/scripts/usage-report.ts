#!/usr/bin/env tsx
/**
 * API usage report — reads backend/cost-log.jsonl and prints a summary.
 *
 * Usage:
 *   npm run usage                  — all-time report
 *   npm run usage -- --days 7      — last 7 days only
 *   npm run usage -- --feature outreach   — filter by feature prefix
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_PATH = join(__dirname, '..', 'cost-log.jsonl');

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const daysArg = args.indexOf('--days');
const daysFilter = daysArg !== -1 ? parseInt(args[daysArg + 1] ?? '0', 10) : 0;
const featureArg = args.indexOf('--feature');
const featureFilter = featureArg !== -1 ? (args[featureArg + 1] ?? '').toLowerCase() : '';

// ── Types ────────────────────────────────────────────────────────────────────

interface CostLogItem {
  type: 'llm' | 'exa';
  label: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  searches?: number;
  cost: number;
}

interface CostLogEntry {
  ts: string;
  feature: string;
  items: CostLogItem[];
  total: number;
}

// ── Load log ─────────────────────────────────────────────────────────────────

if (!existsSync(LOG_PATH)) {
  console.log('No cost-log.jsonl found. Make sure the backend has processed at least one request.');
  process.exit(0);
}

const lines = readFileSync(LOG_PATH, 'utf-8')
  .split('\n')
  .filter((l) => l.trim().length > 0);

let entries: CostLogEntry[] = [];
for (const line of lines) {
  try {
    entries.push(JSON.parse(line) as CostLogEntry);
  } catch {
    // skip malformed lines
  }
}

// ── Apply filters ─────────────────────────────────────────────────────────────

if (daysFilter > 0) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysFilter);
  entries = entries.filter((e) => new Date(e.ts) >= cutoff);
}
if (featureFilter) {
  entries = entries.filter((e) => e.feature.toLowerCase().includes(featureFilter));
}

if (entries.length === 0) {
  console.log('No matching entries found.');
  process.exit(0);
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

const timestamps = entries.map((e) => new Date(e.ts));
const minDate = new Date(Math.min(...timestamps.map((d) => d.getTime())));
const maxDate = new Date(Math.max(...timestamps.map((d) => d.getTime())));
const daySpan = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86_400_000) + 1;

interface FeatureRow {
  requests: number;
  llmCost: number;
  exaCost: number;
  total: number;
}

interface ModelRow {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  cost: number;
}

const byFeature = new Map<string, FeatureRow>();
const byModel = new Map<string, ModelRow>();
const byDay = new Map<string, { cost: number; requests: number }>();

let grandLlm = 0;
let grandExa = 0;

for (const entry of entries) {
  // Feature
  const feat = byFeature.get(entry.feature) ?? { requests: 0, llmCost: 0, exaCost: 0, total: 0 };
  feat.requests += 1;
  feat.total += entry.total;

  // Day
  const day = entry.ts.slice(0, 10);
  const dayRow = byDay.get(day) ?? { cost: 0, requests: 0 };
  dayRow.cost += entry.total;
  dayRow.requests += 1;
  byDay.set(day, dayRow);

  for (const item of entry.items) {
    if (item.type === 'llm') {
      feat.llmCost += item.cost;
      grandLlm += item.cost;

      const model = item.model ?? 'unknown';
      const mr = byModel.get(model) ?? { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, cost: 0 };
      mr.calls += 1;
      mr.inputTokens += item.inputTokens ?? 0;
      mr.outputTokens += item.outputTokens ?? 0;
      mr.cacheWriteTokens += item.cacheWriteTokens ?? 0;
      mr.cacheReadTokens += item.cacheReadTokens ?? 0;
      mr.cost += item.cost;
      byModel.set(model, mr);
    } else {
      feat.exaCost += item.cost;
      grandExa += item.cost;
    }
  }

  byFeature.set(entry.feature, feat);
}

const grandTotal = grandLlm + grandExa;

// ── Helpers ───────────────────────────────────────────────────────────────────

function usd(n: number) {
  return `$${n.toFixed(4)}`;
}

function pad(s: string | number, w: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(w) : str.padEnd(w);
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function bar(cost: number, maxCost: number, width = 20): string {
  const filled = maxCost > 0 ? Math.round((cost / maxCost) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Print report ──────────────────────────────────────────────────────────────

const LINE = '─'.repeat(72);
const DLINE = '═'.repeat(72);

console.log('\n' + DLINE);
console.log(' API USAGE REPORT');
const filterNote = [
  daysFilter > 0 ? `last ${daysFilter} days` : '',
  featureFilter ? `feature: "${featureFilter}"` : '',
].filter(Boolean).join(', ');
console.log(` ${fmtDate(minDate)} → ${fmtDate(maxDate)}   (${daySpan} day span, ${entries.length} requests${filterNote ? ` | ${filterNote}` : ''})`);
console.log(DLINE);

// ── By Feature ────────────────────────────────────────────────────────────────
console.log('\n BREAKDOWN BY FEATURE\n');
console.log(
  ` ${pad('Feature', 30)}  ${pad('Req', 5, true)}  ${pad('Anthropic', 10, true)}  ${pad('Exa', 10, true)}  ${pad('Total', 10, true)}`,
);
console.log(' ' + LINE);

const sortedFeatures = [...byFeature.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [feature, row] of sortedFeatures) {
  console.log(
    ` ${pad(feature, 30)}  ${pad(row.requests, 5, true)}  ${pad(usd(row.llmCost), 10, true)}  ${pad(usd(row.exaCost), 10, true)}  ${pad(usd(row.total), 10, true)}`,
  );
}
console.log(' ' + LINE);
console.log(
  ` ${pad('TOTAL', 30)}  ${pad(entries.length, 5, true)}  ${pad(usd(grandLlm), 10, true)}  ${pad(usd(grandExa), 10, true)}  ${pad(usd(grandTotal), 10, true)}`,
);

// ── By Model ──────────────────────────────────────────────────────────────────
if (byModel.size > 0) {
  console.log('\n\n BREAKDOWN BY MODEL\n');
  console.log(
    ` ${pad('Model', 35)}  ${pad('Calls', 5, true)}  ${pad('Input', 7, true)}  ${pad('Output', 7, true)}  ${pad('Cache-W', 7, true)}  ${pad('Cost', 10, true)}`,
  );
  console.log(' ' + LINE);

  const sortedModels = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);
  for (const [model, row] of sortedModels) {
    console.log(
      ` ${pad(model, 35)}  ${pad(row.calls, 5, true)}  ${pad(fmtK(row.inputTokens), 7, true)}  ${pad(fmtK(row.outputTokens), 7, true)}  ${pad(fmtK(row.cacheWriteTokens), 7, true)}  ${pad(usd(row.cost), 10, true)}`,
    );
  }
}

// ── Daily spend ───────────────────────────────────────────────────────────────
const sortedDays = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const displayDays = daysFilter > 0 ? sortedDays : sortedDays.slice(-14);
const maxDayCost = Math.max(...displayDays.map(([, v]) => v.cost));

if (displayDays.length > 0) {
  const label = daysFilter > 0 ? `DAILY (last ${daysFilter} days)` : 'DAILY (last 14 days)';
  console.log(`\n\n ${label}\n`);
  for (const [day, row] of displayDays) {
    const b = bar(row.cost, maxDayCost, 24);
    console.log(` ${day}  ${b}  ${pad(usd(row.cost), 8, true)}  (${row.requests} req)`);
  }
}

// ── Summary line ──────────────────────────────────────────────────────────────
console.log('\n' + DLINE);
console.log(` GRAND TOTAL:  ${usd(grandTotal)}   (Anthropic: ${usd(grandLlm)}  Exa: ${usd(grandExa)})`);
console.log(DLINE + '\n');
