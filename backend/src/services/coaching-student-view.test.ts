import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CoachingPack } from '@advance-academy/contracts/coaching';
import { toStudentPack } from './coaching-session.service.js';

/**
 * The student's copy of the pack.
 *
 * Two failures this guards against, both quiet:
 *
 *  1. The coach's blunt read reaching the student unmediated. `weaknesses` and
 *     `redFlags` are written to help a coach plan an hour — "short tenure
 *     pattern, the panel will ask", "this is a skills gap, not a framing
 *     problem". Correct for a coach; a verdict when read alone.
 *  2. The narrowing living in the UI instead of the server. A component that
 *     happens not to render a field still shipped it to the browser.
 */

const PACK: CoachingPack = {
  version: 1,
  studentOnePager: {
    headline: 'Ops professional pivoting into analytics',
    currentPosition: 'Customer Support Associate',
    strengths: ['Data quality ownership', 'High-volume throughput'],
    weaknesses: ['No SQL anywhere on the CV', 'No analytical role history at all'],
    historyNotes: ['Dream Company scored readiness 6/10'],
  },
  companyBrief: {
    companyName: 'Acme',
    sparse: false,
    sparseReasons: [],
    overview: [{ claim: 'Acme sells widgets', sourceUrl: 'https://acme.com' }],
    products: [],
    recentActivity: [],
    culture: [],
    interviewAngles: ['Ask about the widget margin'],
    registry: null,
    sources: [{ url: 'https://acme.com', title: null, provider: 'jina' }],
    missingInfo: [],
    generatedAt: '2026-07-31T00:00:00.000Z',
  },
  fit: {
    positioning: 'Frame her as an operator who already thinks in data quality.',
    sellingPoints: [{ point: 'Cut errors 30%', evidence: 'CV bullet about checklists' }],
    starStories: [
      {
        competency: 'Process improvement',
        situation: 's',
        task: 't',
        action: 'a',
        result: 'r',
        sourceBullet: 'b',
      },
    ],
    rows: [
      { requirement: 'SQL', evidence: null, strength: 'gap', probeRisk: 'Will be tested live' },
      { requirement: 'Stakeholder comms', evidence: 'Trained five hires', strength: 'strong', probeRisk: null },
    ],
    redFlags: [
      'Short tenure pattern emerging — the panel may ask.',
      'Career pivot with no bridging evidence: no course, no portfolio.',
    ],
  },
  questions: [
    {
      id: 'q1',
      question: 'What SQL have you written recently?',
      category: 'technical',
      difficulty: 'hard',
      whyAsked: 'It is the core requirement and the CV shows nothing.',
      suggestedAnswer: 'Do not bluff. Name what she is actually learning.',
    },
  ],
  reverseQuestions: ['How is the team structured?'],
  agenda: [{ minutes: 60, title: 'Rehearse the SQL gap answer', detail: 'Twice, second time cold.' }],
  generatedAt: '2026-07-31T00:00:00.000Z',
  model: 'claude-sonnet-4-6',
  costUsd: 0.2241,
};

const STUDENT = toStudentPack(PACK, '2026-07-31T10:00:00.000Z');

test("the coach's blunt read does not reach the student", () => {
  const serialised = JSON.stringify(STUDENT);
  for (const phrase of [
    'Short tenure pattern',
    'Career pivot with no bridging evidence',
    'No SQL anywhere on the CV',
    'No analytical role history',
  ]) {
    assert.ok(!serialised.includes(phrase), `student pack leaked: "${phrase}"`);
  }
});

test('the agenda is the coach\'s plan and stays with them', () => {
  assert.ok(!('agenda' in STUDENT));
  assert.ok(!JSON.stringify(STUDENT).includes('second time cold'));
});

test('cost and model are internal', () => {
  assert.ok(!('costUsd' in STUDENT));
  assert.ok(!('model' in STUDENT));
});

test('gaps in the fit table DO reach the student', () => {
  // Not an oversight. Knowing which requirements they cannot evidence is the
  // single most useful thing they can take away before the interview.
  const sqlRow = STUDENT.fitRows.find((r) => r.requirement === 'SQL');
  assert.equal(sqlRow?.strength, 'gap');
  assert.equal(sqlRow?.evidence, null);
  assert.equal(sqlRow?.probeRisk, 'Will be tested live');
});

test('everything they need to prepare survives', () => {
  assert.equal(STUDENT.headline, PACK.studentOnePager.headline);
  assert.deepEqual(STUDENT.strengths, PACK.studentOnePager.strengths);
  assert.equal(STUDENT.positioning, PACK.fit.positioning);
  assert.deepEqual(STUDENT.sellingPoints, PACK.fit.sellingPoints);
  assert.deepEqual(STUDENT.starStories, PACK.fit.starStories);
  assert.deepEqual(STUDENT.questions, PACK.questions);
  assert.deepEqual(STUDENT.reverseQuestions, PACK.reverseQuestions);
  assert.equal(STUDENT.approvedAt, '2026-07-31T10:00:00.000Z');
});

test('the company brief travels whole, sources included', () => {
  // The citations are the reason the student can trust it — stripping them
  // would leave assertions about a company with nothing behind them.
  assert.deepEqual(STUDENT.companyBrief, PACK.companyBrief);
  assert.equal(STUDENT.companyBrief.overview[0].sourceUrl, 'https://acme.com');
});

test('the shape is versioned, like the coach pack', () => {
  assert.equal(STUDENT.version, 1);
});
