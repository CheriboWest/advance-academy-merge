import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeDay } from '@advance-academy/contracts';

/**
 * Lives in contracts because the users table and the person drawer both render
 * it; tested from here because the frontend has no test runner. It is the only
 * thing standing between a timestamp and the word an admin actually scans for.
 */

const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

test('recent activity reads in days', () => {
  assert.equal(relativeDay(daysAgo(0), NOW), 'today');
  assert.equal(relativeDay(daysAgo(1), NOW), 'yesterday');
  assert.equal(relativeDay(daysAgo(3), NOW), '3 days ago');
  assert.equal(relativeDay(daysAgo(29), NOW), '29 days ago');
});

test('a month is where days stop being readable', () => {
  assert.equal(relativeDay(daysAgo(30), NOW), 'a month ago');
  assert.equal(relativeDay(daysAgo(75), NOW), '2 months ago');
});

test('past a year it switches again rather than saying "24 months ago"', () => {
  assert.equal(relativeDay(daysAgo(400), NOW), 'a year ago');
  assert.equal(relativeDay(daysAgo(800), NOW), '2 years ago');
});

test('a future timestamp is today, not a negative count', () => {
  // Clock skew between the database and the reader's machine is real, and
  // "in -1 days" in an admin table looks like a bug in the data.
  assert.equal(relativeDay(new Date(NOW + 60_000).toISOString(), NOW), 'today');
});

test('no timestamp and junk both read as never', () => {
  assert.equal(relativeDay(null, NOW), 'never');
  assert.equal(relativeDay(undefined, NOW), 'never');
  assert.equal(relativeDay('', NOW), 'never');
  assert.equal(relativeDay('not a date', NOW), 'never');
});
