#!/usr/bin/env tsx
/**
 * Inspect what the coaching tool knows about a student, and what Stage 0 would
 * decide about it (tickets T2/T3.5).
 *
 * Usage (from the repo root or backend/):
 *   npm run context:check --workspace backend -- student@example.com
 *
 * Read-only: it queries, it never writes. Safe to point at production.
 *
 * It prints the inventory once — that is the real data, and it is exactly what
 * the student's context picker will show — then runs the readiness assessment
 * twice against it, with a full job description and with none, so both branches
 * of the Stage 0 decision are visible side by side.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { getSupabase } from '../src/lib/supabase.js';
import {
  assessContextReadiness,
  listStudentContext,
  type ReadinessInput,
} from '../src/services/coaching-context.service.js';
import type { ContextItem, StudentContextInventory } from '@advance-academy/contracts/coaching';

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'backend/.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile?.(candidate);
    break;
  }
}

const identifier = process.argv.slice(2).filter((a) => a !== '--')[0];

const SAMPLE_JD = `Data Analyst — London (hybrid)

You will own reporting for the commercial team: building dashboards, running
analyses that shape pricing decisions, and partnering with finance on forecasts.

Requirements: strong SQL, Python or R, experience with a BI tool (Looker,
Tableau or similar), and the ability to explain analysis to non-technical
stakeholders. Two or more years in an analytical role. Nice to have: dbt,
experiment design, experience in a regulated industry.`;

function heading(text: string) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

function printItems(label: string, items: ContextItem[]) {
  console.log(`\n  ${label} (${items.length})`);
  if (items.length === 0) {
    console.log('    (none)');
    return;
  }
  for (const i of items) {
    const star = i.recommended ? '\x1b[32m★\x1b[0m' : ' ';
    const when = new Date(i.createdAt).toLocaleDateString();
    console.log(`    ${star} ${i.label}`);
    console.log(`      \x1b[2m${i.detail ?? 'no detail available'} · ${when}\x1b[0m`);
  }
}

const VERDICT_COLOUR: Record<string, string> = {
  ready: '\x1b[32m',
  needs_coach: '\x1b[33m',
  blocked: '\x1b[31m',
};

function printReadiness(title: string, input: ReadinessInput) {
  const report = assessContextReadiness(input);
  const colour = VERDICT_COLOUR[report.verdict] ?? '';
  heading(title);
  console.log(`  verdict  ${colour}${report.verdict.toUpperCase()}\x1b[0m   score ${report.score}/100`);
  console.log(
    `  signals  cv=${report.signals.cv} · jd=${report.signals.jd} · company=${report.signals.company}` +
      ` · history=${report.signals.studentHistory} · details=${report.signals.interviewDetails}`,
  );

  if (report.gaps.length === 0) {
    console.log('  gaps     none — this would generate without the coach touching it');
    return;
  }
  console.log(`  gaps     ${report.gaps.length}`);
  for (const g of report.gaps) {
    const tag = g.severity === 'blocking' ? '\x1b[31mBLOCK\x1b[0m' : g.severity === 'important' ? '\x1b[33mIMPT \x1b[0m' : 'nice ';
    console.log(`    [${tag}] ${g.label}`);
    console.log(`             \x1b[2m→ ${g.action}\x1b[0m`);
  }
}

async function resolveStudentId(value: string): Promise<{ id: string; email: string | null }> {
  const supabase = getSupabase();
  const column = value.includes('@') ? 'email' : 'id';
  const { data, error } = await supabase
    .from('users')
    .select('id, email')
    .eq(column, value)
    .maybeSingle();

  if (error) throw new Error(`User lookup failed: ${error.message}`);
  if (!data) throw new Error(`No account found for "${value}".`);
  return { id: data.id as string, email: (data.email as string | null) ?? null };
}

function summarise(inv: StudentContextInventory): number {
  return inv.cvs.length + inv.dreamRuns.length + inv.mockInterviews.length + inv.cvAnalyses.length;
}

async function main() {
  if (!identifier) {
    console.error('Usage: npm run context:check --workspace backend -- <email or user id>');
    process.exit(1);
  }

  const student = await resolveStudentId(identifier);
  console.log(`\nStudent: ${student.email ?? '(no email)'}  [${student.id}]`);

  const inventory = await listStudentContext(student.id);

  heading(`INVENTORY — ${summarise(inventory)} item(s)   \x1b[2m★ = recommended by default\x1b[0m`);
  printItems('CVs', inventory.cvs);
  printItems('Dream Company runs', inventory.dreamRuns);
  printItems('Mock interviews', inventory.mockInterviews);
  printItems('CV analyses', inventory.cvAnalyses);

  printReadiness('STAGE 0 — as a fully filled booking', {
    inventory,
    jdText: SAMPLE_JD,
    companyUrl: 'https://example.com',
    companySparse: false,
    stage: 'final round',
    interviewerRole: 'Head of Data',
    worryText: 'I freeze on competency questions',
  });

  printReadiness('STAGE 0 — as a bare booking (no JD, no details)', {
    inventory,
    jdText: '',
  });

  console.log(
    '\n\x1b[2mA READY verdict generates the pack automatically; anything else waits for the coach.\x1b[0m',
  );
}

main().catch((err) => {
  console.error('\n✗ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
