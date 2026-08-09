#!/usr/bin/env tsx
/**
 * Run the pack pipeline for one coaching session and print the result (T4).
 *
 * Usage (from the repo root or backend/):
 *   npm run generate:pack --workspace backend -- <sessionId>
 *   npm run generate:pack --workspace backend -- <sessionId> --force
 *
 * `--force` generates even when Stage 0 says the context is thin — the same
 * thing the coach's "generate anyway" button will do from the Context Desk.
 *
 * This makes real calls: web research plus four Sonnet stages, a few tens of
 * cents a run, logged to cost-log.jsonl. It writes the pack onto the session
 * row exactly as the API path does, because it is the same function.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { getSupabase } from '../src/lib/supabase.js';
import { generateCoachingPack } from '../src/services/coaching-pack.service.js';
import type { CoachingPack } from '@advance-academy/contracts/coaching';

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'backend/.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile?.(candidate);
    break;
  }
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const sessionId = args.find((a) => !a.startsWith('--'));
const force = args.includes('--force');

function heading(text: string) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

const STRENGTH_MARK = { strong: '\x1b[32m●\x1b[0m', partial: '\x1b[33m◐\x1b[0m', gap: '\x1b[31m○\x1b[0m' };

function printPack(pack: CoachingPack) {
  heading('ONE-PAGER');
  console.log(`  ${pack.studentOnePager.headline}`);
  console.log(`  \x1b[2m${pack.studentOnePager.currentPosition}\x1b[0m`);
  for (const s of pack.studentOnePager.strengths) console.log(`  \x1b[32m+\x1b[0m ${s}`);
  for (const w of pack.studentOnePager.weaknesses) console.log(`  \x1b[31m-\x1b[0m ${w}`);
  for (const n of pack.studentOnePager.historyNotes) console.log(`  \x1b[2m· ${n}\x1b[0m`);

  heading('POSITIONING');
  console.log(`  ${pack.fit.positioning}`);

  heading(`SELLING POINTS (${pack.fit.sellingPoints.length})`);
  for (const p of pack.fit.sellingPoints) {
    console.log(`  • ${p.point}`);
    console.log(`    \x1b[2m↳ ${p.evidence}\x1b[0m`);
  }

  heading(`STAR STORIES (${pack.fit.starStories.length})`);
  for (const s of pack.fit.starStories) {
    console.log(`  • ${s.competency}: ${s.action} → ${s.result}`);
    console.log(`    \x1b[2mfrom CV: ${s.sourceBullet}\x1b[0m`);
  }

  heading(`FIT TABLE (${pack.fit.rows.length})   ● strong  ◐ partial  ○ gap`);
  for (const r of pack.fit.rows) {
    console.log(`  ${STRENGTH_MARK[r.strength]} ${r.requirement}`);
    console.log(`    \x1b[2m${r.evidence ?? 'no CV evidence'}\x1b[0m`);
    if (r.probeRisk) console.log(`    \x1b[33m⚠ ${r.probeRisk}\x1b[0m`);
  }

  heading(`RED FLAGS (${pack.fit.redFlags.length})`);
  for (const f of pack.fit.redFlags) console.log(`  ⚠ ${f}`);

  heading(`QUESTIONS (${pack.questions.length})`);
  for (const q of pack.questions) {
    console.log(`  [${q.category}/${q.difficulty}] ${q.question}`);
    console.log(`    \x1b[2mwhy: ${q.whyAsked}\x1b[0m`);
    console.log(`    \x1b[2m→ ${q.suggestedAnswer}\x1b[0m`);
  }

  heading(`QUESTIONS TO ASK THEM (${pack.reverseQuestions.length})`);
  for (const q of pack.reverseQuestions) console.log(`  • ${q}`);

  const total = pack.agenda.reduce((s, a) => s + a.minutes, 0);
  heading(`AGENDA (${pack.agenda.length} blocks, ${total} minutes)`);
  for (const a of pack.agenda) {
    console.log(`  ${String(a.minutes).padStart(3)}m  ${a.title}`);
    console.log(`        \x1b[2m${a.detail}\x1b[0m`);
  }

  heading('COMPANY BRIEF');
  console.log(`  sparse ${pack.companyBrief.sparse ? '\x1b[33mYES\x1b[0m' : 'no'} · ` +
    `${pack.companyBrief.sources.length} sources · ` +
    `${pack.companyBrief.overview.length + pack.companyBrief.products.length +
       pack.companyBrief.recentActivity.length + pack.companyBrief.culture.length} cited claims`);
}

async function main() {
  if (!sessionId) {
    console.error('Usage: npm run generate:pack --workspace backend -- <sessionId> [--force]');
    process.exit(1);
  }

  console.log(`\nGenerating the pack for ${sessionId}${force ? ' (forced)' : ''}…`);
  const startedAt = Date.now();

  const { status } = await generateCoachingPack(sessionId, { force });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  const { data } = await getSupabase()
    .from('coaching_sessions')
    .select('status, generated_pack, context_report, error_json')
    .eq('id', sessionId)
    .maybeSingle();

  heading('RESULT');
  console.log(`  status  ${status}`);
  console.log(`  took    ${elapsed}s`);

  if (status === 'context_needed') {
    const report = data?.context_report as { verdict?: string; gaps?: { label: string; action: string }[] } | null;
    console.log(`  verdict ${report?.verdict}`);
    heading('STOPPED BEFORE THE EXPENSIVE STAGES — what the coach must add');
    for (const g of report?.gaps ?? []) {
      console.log(`  ! ${g.label}`);
      console.log(`    \x1b[2m→ ${g.action}\x1b[0m`);
    }
    console.log('\n\x1b[2mRe-run with --force to generate anyway.\x1b[0m');
    return;
  }

  if (status === 'failed') {
    console.log(`  error   ${JSON.stringify(data?.error_json)}`);
    process.exit(1);
  }

  const pack = data?.generated_pack as CoachingPack | null;
  if (!pack) {
    console.error('  ✗ status is ready but no pack was stored.');
    process.exit(1);
  }
  console.log(`  cost    $${pack.costUsd.toFixed(4)} · model ${pack.model}`);
  printPack(pack);
}

main().catch((err) => {
  console.error('\n✗ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
