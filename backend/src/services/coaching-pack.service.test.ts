import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanyBrief } from '@advance-academy/contracts/coaching';
import {
  flattenCompanyFacts,
  normaliseAgenda,
  normaliseFit,
  normaliseOnePager,
  normaliseQuestions,
} from './coaching-pack.service.js';

/**
 * The pack is read by a coach and then, in trimmed form, by a student before a
 * real interview. Two things must hold whatever the model returns:
 *
 *  - a JD requirement with no CV evidence must never read as covered;
 *  - the agenda's minutes must add up, because a coach follows them as a plan.
 *
 * Everything else here guards against a malformed response taking the pipeline
 * down after three paid-for stages.
 */

// ── Fit ────────────────────────────────────────────────────────────────────

test('a requirement with no evidence is a gap regardless of what the model called it', () => {
  // The dangerous case: the model labels something "strong" and leaves evidence
  // empty. A coach skimming the table would take that as covered and skip it.
  const fit = normaliseFit({
    rows: [
      { requirement: 'Five years of dbt', evidence: '', strength: 'strong', probeRisk: null },
      { requirement: 'SQL', evidence: 'Built the reporting warehouse', strength: 'strong' },
    ],
  });
  assert.equal(fit.rows[0].strength, 'gap');
  assert.equal(fit.rows[0].evidence, null);
  assert.equal(fit.rows[1].strength, 'strong');
});

test('an unrecognised strength value falls back by evidence, not to strong', () => {
  const fit = normaliseFit({
    rows: [{ requirement: 'Python', evidence: 'Wrote the ETL', strength: 'excellent' }],
  });
  assert.equal(fit.rows[0].strength, 'partial');
});

test('rows without a requirement are dropped', () => {
  const fit = normaliseFit({ rows: [{ evidence: 'something' }, { requirement: 'SQL' }] });
  assert.equal(fit.rows.length, 1);
  assert.equal(fit.rows[0].requirement, 'SQL');
});

test('star stories missing their action are dropped', () => {
  // A half-formed STAR story is worse than none — the coach rehearses a shape
  // that collapses the moment the student is asked what they actually did.
  const fit = normaliseFit({
    starStories: [
      { competency: 'Ownership', situation: 's', task: 't', action: '', result: 'r', sourceBullet: 'b' },
      { competency: 'Delivery', situation: 's', task: 't', action: 'shipped it', result: 'r', sourceBullet: 'b' },
    ],
  });
  assert.equal(fit.starStories.length, 1);
  assert.equal(fit.starStories[0].competency, 'Delivery');
});

test('a garbage fit object yields an empty analysis rather than throwing', () => {
  const fit = normaliseFit(null);
  assert.deepEqual(fit.rows, []);
  assert.deepEqual(fit.redFlags, []);
  assert.equal(fit.positioning, '');
});

// ── Questions ──────────────────────────────────────────────────────────────

test('question ids are derived from the session, so coach edits survive a reload', () => {
  const a = normaliseQuestions([{ question: 'Q1' }, { question: 'Q2' }], 'abcdef12-3456-7890');
  const b = normaliseQuestions([{ question: 'Q1' }, { question: 'Q2' }], 'abcdef12-3456-7890');
  assert.deepEqual(
    a.map((q) => q.id),
    b.map((q) => q.id),
  );
  assert.equal(a[0].id, 'abcdef12-q1');
});

test('unknown category and difficulty fall back to safe defaults', () => {
  const [q] = normaliseQuestions([{ question: 'Q', category: 'philosophical', difficulty: 'brutal' }], 's');
  assert.equal(q.category, 'behavioural');
  assert.equal(q.difficulty, 'medium');
});

test('empty questions are dropped and the list is capped', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ question: `Q${i}` }));
  assert.equal(normaliseQuestions([...many, { question: '  ' }], 's').length, 25);
});

// ── Agenda ─────────────────────────────────────────────────────────────────

test('an agenda that already fits is left alone', () => {
  const agenda = normaliseAgenda(
    [
      { minutes: 20, title: 'A', detail: 'x' },
      { minutes: 40, title: 'B', detail: 'y' },
    ],
    60,
  );
  assert.deepEqual(agenda.map((a) => a.minutes), [20, 40]);
});

test('an over-long agenda is scaled to the session, keeping its proportions', () => {
  // The model routinely plans 90 minutes for an hour. Rejecting it would waste
  // the call; the ordering and relative weights are the valuable part.
  const agenda = normaliseAgenda(
    [
      { minutes: 30, title: 'A', detail: 'x' },
      { minutes: 60, title: 'B', detail: 'y' },
    ],
    60,
  );
  assert.equal(agenda.reduce((s, a) => s + a.minutes, 0), 60);
  assert.ok(agenda[1].minutes > agenda[0].minutes);
});

test('a short agenda is scaled up to fill the session', () => {
  const agenda = normaliseAgenda(
    [
      { minutes: 5, title: 'A', detail: 'x' },
      { minutes: 5, title: 'B', detail: 'y' },
    ],
    60,
  );
  assert.equal(agenda.reduce((s, a) => s + a.minutes, 0), 60);
});

test('rounding drift never leaves the total wrong', () => {
  // Three equal blocks over 100 minutes is the classic 33/33/33 = 99 case.
  const agenda = normaliseAgenda(
    [
      { minutes: 1, title: 'A', detail: '' },
      { minutes: 1, title: 'B', detail: '' },
      { minutes: 1, title: 'C', detail: '' },
    ],
    100,
  );
  assert.equal(agenda.reduce((s, a) => s + a.minutes, 0), 100);
});

test('untitled or zero-minute blocks are dropped', () => {
  const agenda = normaliseAgenda(
    [
      { minutes: 0, title: 'Nothing', detail: '' },
      { minutes: 10, title: '', detail: '' },
      { minutes: 60, title: 'Real', detail: 'do the thing' },
    ],
    60,
  );
  assert.equal(agenda.length, 1);
  assert.equal(agenda[0].title, 'Real');
});

test('a non-array agenda yields an empty plan rather than throwing', () => {
  assert.deepEqual(normaliseAgenda('20 minutes on X', 60), []);
});

// ── One-pager + company facts ──────────────────────────────────────────────

test('the one-pager tolerates missing fields', () => {
  const p = normaliseOnePager({ headline: ' Data analyst ', strengths: ['a', 3, ''] });
  assert.equal(p.headline, 'Data analyst');
  assert.deepEqual(p.strengths, ['a']);
  assert.deepEqual(p.weaknesses, []);
});

test('company facts flatten to claims across every cited section', () => {
  const brief = {
    overview: [{ claim: 'Digital bank', sourceUrl: 'u1' }],
    products: [{ claim: 'Current accounts', sourceUrl: 'u1' }],
    recentActivity: [{ claim: 'New CEO', sourceUrl: 'u2' }],
    culture: [{ claim: 'Remote friendly', sourceUrl: 'u1' }],
  } as unknown as CompanyBrief;

  assert.deepEqual(flattenCompanyFacts(brief), [
    'Digital bank',
    'Current accounts',
    'New CEO',
    'Remote friendly',
  ]);
});
