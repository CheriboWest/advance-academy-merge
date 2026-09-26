import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  taskProgress,
  unsubscribeToken,
  utcDay,
  verifyUnsubscribeToken,
  weekStartUtc,
} from './engagement.js';

test('weekStartUtc: any day maps to its Monday, Monday maps to itself', () => {
  assert.equal(utcDay(weekStartUtc(new Date('2026-09-26T15:00:00Z'))), '2026-09-21'); // Saturday
  assert.equal(utcDay(weekStartUtc(new Date('2026-09-27T23:59:59Z'))), '2026-09-21'); // Sunday
  assert.equal(utcDay(weekStartUtc(new Date('2026-09-28T00:00:00Z'))), '2026-09-28'); // Monday
});

test('taskProgress: caps progress at the target and marks done', () => {
  const tasks = taskProgress({ applications: 12, jobs_saved: 2, cv_runs: 0, cover_letters: 1, interviews: 0 });
  const apply = tasks.find((t) => t.key === 'apply_10')!;
  assert.equal(apply.progress, 10);
  assert.equal(apply.done, true);
  const save = tasks.find((t) => t.key === 'save_5')!;
  assert.equal(save.progress, 2);
  assert.equal(save.done, false);
  assert.equal(tasks.find((t) => t.key === 'cover_letter')!.done, true);
});

test('unsubscribe token: verifies for its own user only', () => {
  const t = unsubscribeToken('user-a', 'secret');
  assert.equal(verifyUnsubscribeToken('user-a', t, 'secret'), true);
  assert.equal(verifyUnsubscribeToken('user-b', t, 'secret'), false);
  assert.equal(verifyUnsubscribeToken('user-a', t, 'other-secret'), false);
  assert.equal(verifyUnsubscribeToken('user-a', 'short', 'secret'), false);
});

test('escapeHtml: neutralises markup from job titles and names', () => {
  assert.equal(escapeHtml('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
});
