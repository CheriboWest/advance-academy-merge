import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ContextItem, StudentContextInventory } from '@advance-academy/contracts/coaching';
import { assessContextReadiness } from './coaching-context.service.js';

/**
 * Stage 0 is the gate in front of four Sonnet calls. Two ways it can be wrong:
 *
 *  - too lenient: a booking with no CV sails through, the pack is generated from
 *    nothing, and the coach throws away work they paid for;
 *  - too strict: every booking lands in the Context Desk, which recreates the
 *    manual labour the tool exists to remove.
 *
 * These pin both edges, and pin that gaps stay actionable — a coach must be able
 * to read one and know what to paste.
 */

function item(over: Partial<ContextItem> = {}): ContextItem {
  return {
    id: 'id-1',
    kind: 'cv',
    label: 'CV',
    detail: '12 bullets parsed',
    createdAt: '2026-07-01T00:00:00.000Z',
    recommended: true,
    ...over,
  };
}

function inventory(over: Partial<StudentContextInventory> = {}): StudentContextInventory {
  return {
    studentId: 'student-1',
    cvs: [],
    dreamRuns: [],
    mockInterviews: [],
    cvAnalyses: [],
    ...over,
  };
}

const FULL_JD =
  'We are looking for a Data Analyst to join our team. '.repeat(12); // comfortably over 400 chars

const RICH = {
  inventory: inventory({
    cvs: [item()],
    dreamRuns: [item({ id: 'd1', kind: 'dream_run', detail: 'readiness 7/10 · mid level' })],
    mockInterviews: [item({ id: 'm1', kind: 'mock_interview', detail: 'friendly interviewer' })],
  }),
  jdText: FULL_JD,
  companyUrl: 'https://acme.com',
  companySparse: false,
  stage: 'final',
  interviewerRole: 'Head of Data',
  worryText: 'I freeze on competency questions',
};

test('a complete booking is ready and needs no coach', () => {
  const report = assessContextReadiness(RICH);
  assert.equal(report.verdict, 'ready');
  assert.equal(report.gaps.length, 0);
  assert.equal(report.score, 100);
});

test('no CV blocks outright', () => {
  const report = assessContextReadiness({ ...RICH, inventory: inventory() });
  assert.equal(report.verdict, 'blocked');
  assert.equal(report.signals.cv, 'missing');
  assert.ok(report.gaps.some((g) => g.id === 'cv-missing' && g.severity === 'blocking'));
});

test('no JD blocks outright', () => {
  const report = assessContextReadiness({ ...RICH, jdText: 'Data Analyst' });
  assert.equal(report.verdict, 'blocked');
  assert.equal(report.signals.jd, 'missing');
});

test('a short JD does not block but does stop auto-generation', () => {
  // The dangerous middle: enough to look like a JD, not enough to align against.
  const report = assessContextReadiness({
    ...RICH,
    jdText: 'Data Analyst. SQL and Python. Apply within. Great team, fast growth.',
  });
  assert.equal(report.verdict, 'needs_coach');
  assert.equal(report.signals.jd, 'thin');
  assert.ok(report.gaps.some((g) => g.id === 'jd-thin'));
});

test('a raw CV with no bullets still generates, flagged', () => {
  const report = assessContextReadiness({
    ...RICH,
    inventory: inventory({ ...RICH.inventory, cvs: [item({ detail: 'raw text only, not parsed' })] }),
  });
  assert.equal(report.verdict, 'needs_coach');
  assert.equal(report.signals.cv, 'raw_only');
  assert.ok(report.gaps.some((g) => g.id === 'cv-not-parsed'));
});

test('sparse company research routes to the Context Desk with a URL-aware action', () => {
  const withUrl = assessContextReadiness({ ...RICH, companySparse: true });
  assert.equal(withUrl.verdict, 'needs_coach');
  assert.equal(withUrl.signals.company, 'sparse');
  assert.ok(withUrl.gaps.some((g) => g.action.includes('Attach more pages')));

  // Without a website the advice has to be different, or it is useless.
  const withoutUrl = assessContextReadiness({ ...RICH, companySparse: true, companyUrl: '' });
  assert.ok(withoutUrl.gaps.some((g) => g.action.includes('Add the company website')));
});

test('company research not having run yet is not held against the booking', () => {
  // Stage 0 may run before T3. "Unknown" must not read as "sparse".
  const report = assessContextReadiness({ ...RICH, companySparse: undefined });
  assert.equal(report.signals.company, 'missing');
  assert.equal(report.verdict, 'ready');
});

test('a student who has used no other tool is noted but not blocked', () => {
  const report = assessContextReadiness({
    ...RICH,
    inventory: inventory({ cvs: [item()] }),
  });
  assert.equal(report.signals.studentHistory, 'none');
  assert.equal(report.verdict, 'ready');
  assert.ok(report.gaps.every((g) => g.severity === 'nice_to_have'));
});

test('unrecommended runs do not count as knowing the student', () => {
  // Pre-migration-018 rows have no input_json, so they carry nothing usable.
  const report = assessContextReadiness({
    ...RICH,
    inventory: inventory({
      cvs: [item()],
      dreamRuns: [item({ id: 'd1', kind: 'dream_run', detail: null, recommended: false })],
    }),
  });
  assert.equal(report.signals.studentHistory, 'none');
});

test('missing round and interviewer is important, not fatal', () => {
  const report = assessContextReadiness({
    ...RICH,
    stage: undefined,
    interviewerRole: undefined,
    worryText: undefined,
  });
  assert.equal(report.verdict, 'needs_coach');
  assert.equal(report.signals.interviewDetails, 'missing');
});

test('a missing worry line alone never blocks generation', () => {
  const report = assessContextReadiness({ ...RICH, worryText: undefined });
  assert.equal(report.verdict, 'ready');
  assert.equal(report.signals.interviewDetails, 'partial');
  assert.ok(report.gaps.some((g) => g.id === 'worry-missing' && g.severity === 'nice_to_have'));
});

test('every gap says what to do, not just what is wrong', () => {
  const report = assessContextReadiness({
    inventory: inventory(),
    jdText: '',
  });
  assert.ok(report.gaps.length > 0);
  for (const gap of report.gaps) {
    assert.ok(gap.label.length > 10, `gap ${gap.id} has no readable label`);
    assert.ok(gap.action.length > 10, `gap ${gap.id} has no action`);
  }
});

test('score stays within 0-100 at both extremes', () => {
  const empty = assessContextReadiness({ inventory: inventory(), jdText: '' });
  assert.ok(empty.score >= 0 && empty.score <= 100);
  assert.equal(assessContextReadiness(RICH).score, 100);
});
