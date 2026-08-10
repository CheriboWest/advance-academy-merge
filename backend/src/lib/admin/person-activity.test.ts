import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PersonEvent } from '@advance-academy/contracts';
import { interviewLabel, mergeTimeline, summariseActivity } from './person-activity.js';

/**
 * These numbers are what an admin decides on — whether someone is engaged enough
 * to be worth a coach's hour. Getting "runs in the last 30 days" wrong by an
 * off-by-one is not visible on screen, so it is pinned here instead.
 */

const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

const ev = (at: string, kind: PersonEvent['kind'], detail: string): PersonEvent => ({
  at,
  kind,
  detail,
  label: `${kind}:${detail}`,
});

test('sources merge into one newest-first list', () => {
  const merged = mergeTimeline([
    [ev(daysAgo(10), 'tool', 'cv'), ev(daysAgo(40), 'tool', 'dream')],
    [ev(daysAgo(1), 'coaching', 'approved')],
  ]);
  assert.deepEqual(
    merged.map((e) => e.detail),
    ['approved', 'cv', 'dream'],
  );
});

test('events with an unusable timestamp are dropped, not sorted to an end', () => {
  const merged = mergeTimeline([
    [ev('not a date', 'tool', 'cv'), ev('', 'tool', 'dream'), ev(daysAgo(2), 'tool', 'interview')],
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].detail, 'interview');
});

test('the 30-day window counts recent events and excludes older ones', () => {
  const timeline = mergeTimeline([
    [ev(daysAgo(1), 'tool', 'cv'), ev(daysAgo(29), 'tool', 'cv'), ev(daysAgo(31), 'tool', 'dream')],
  ]);
  const a = summariseActivity(timeline, NOW);
  assert.equal(a.totalEvents, 3);
  assert.equal(a.events30d, 2);
});

test('an event exactly 30 days old still counts as recent', () => {
  // The boundary is inclusive on purpose; excluding it makes a run that happened
  // "a month ago today" vanish from the number an admin is reading right then.
  const timeline = mergeTimeline([[ev(daysAgo(30), 'tool', 'cv')]]);
  assert.equal(summariseActivity(timeline, NOW).events30d, 1);
});

test('per-tool counts cover tools only, not sessions', () => {
  const timeline = mergeTimeline([
    [
      ev(daysAgo(1), 'tool', 'cv'),
      ev(daysAgo(2), 'tool', 'cv'),
      ev(daysAgo(3), 'tool', 'interview'),
      ev(daysAgo(4), 'coaching', 'approved'),
      ev(daysAgo(5), 'interview', 'complete'),
    ],
  ]);
  const a = summariseActivity(timeline, NOW);
  assert.deepEqual(a.byTool, { cv: 2, interview: 1 });
  assert.equal(a.totalEvents, 5);
});

test('first and last active bracket the whole history', () => {
  const timeline = mergeTimeline([[ev(daysAgo(90), 'tool', 'cv'), ev(daysAgo(2), 'tool', 'dream')]]);
  const a = summariseActivity(timeline, NOW);
  assert.equal(a.lastActiveAt, daysAgo(2));
  assert.equal(a.firstActiveAt, daysAgo(90));
});

test('someone who has done nothing summarises to nulls and zeroes, not an error', () => {
  const a = summariseActivity([], NOW);
  assert.equal(a.lastActiveAt, null);
  assert.equal(a.firstActiveAt, null);
  assert.equal(a.totalEvents, 0);
  assert.equal(a.events30d, 0);
  assert.deepEqual(a.byTool, {});
  assert.deepEqual(a.timeline, []);
});

test('the visible list is capped but the totals are not', () => {
  const many = Array.from({ length: 60 }, (_, i) => ev(daysAgo(i), 'tool', 'cv'));
  const a = summariseActivity(mergeTimeline([many]), NOW);
  assert.equal(a.timeline.length, 40);
  assert.equal(a.totalEvents, 60); // the number an admin reads stays honest
  assert.equal(a.byTool.cv, 60);
});

/* ── Labelling an interview session from an unenforced jsonb snapshot ── */

test('an interview session is labelled by role and company when both are known', () => {
  const label = interviewLabel({
    context_json: { companyName: 'Acme', targetRole: 'Data Analyst' },
    persona_id: 'friendly',
  });
  assert.equal(label, 'Data Analyst · Acme');
});

test('snake_case snapshots are read too', () => {
  assert.equal(interviewLabel({ context_json: { company_name: 'Acme' } }), 'Acme');
});

test('an unusable snapshot falls back to the persona rather than going blank', () => {
  for (const ctx of [null, undefined, 'text', [], {}, { companyName: 42 }]) {
    assert.equal(interviewLabel({ context_json: ctx, persona_id: 'friendly' }), 'friendly');
  }
});

test('with neither snapshot nor persona the row is still identifiable', () => {
  assert.equal(interviewLabel({}), 'Interview session');
});
