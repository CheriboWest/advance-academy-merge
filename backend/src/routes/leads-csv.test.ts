import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_COLUMNS, CSV_HEADER, leadsToCsv, type LeadRow } from '@advance-academy/contracts';

/**
 * The export is what an admin actually works from — they open it in a
 * spreadsheet and start contacting people. It previously carried eleven columns
 * of funnel bookkeeping and no way to reach anyone but by email, because it was
 * hand-written twice (browser button + `?format=csv`) and neither copy knew the
 * phone number existed.
 */

const LEAD: LeadRow = {
  id: 'lead-1',
  email: 'lan@example.com',
  name: 'Lan',
  source: 'quiz',
  lead_magnet_id: 'career-house-quiz',
  whatsapp: '+44 7700 900123',
  whatsapp_digits: '447700900123',
  house: 'AO',
  score_breakdown: 'SG:2 AO:5',
  readiness_score: null,
  consent_marketing: true,
  consent_ts: '2026-08-01T00:00:00.000Z',
  double_optin: false,
  contactable: 'yes',
  contact_reason: 'Opted in and signed in via magic link',
  utm_source: 'fb_group',
  utm_medium: null,
  utm_campaign: null,
  status: 'new',
  created_at: '2026-08-01T00:00:00.000Z',
  has_account: true,
};

test('the export carries a way to reach the person, not just funnel state', () => {
  const csv = leadsToCsv([LEAD]);
  for (const header of ['email', 'whatsapp', 'house_code', 'contactable', 'contact_reason']) {
    assert.ok(CSV_HEADER.split(',').includes(header), `missing column: ${header}`);
  }
  assert.match(csv, /447700900123|7700 900123/);
});

test('every column maps to a real LeadRow field', () => {
  // Guards the rename case: a field dropped from LeadRow must not leave a
  // header emitting `undefined` down the whole file.
  const line = leadsToCsv([LEAD]).split('\n')[1];
  assert.equal(line.split(',').length >= CSV_COLUMNS.length, true);
  assert.doesNotMatch(line, /undefined/);
});

test('commas and quotes in a name do not shift the columns', () => {
  const csv = leadsToCsv([{ ...LEAD, name: 'Nguyen, "Lan"' }]);
  assert.match(csv, /"Nguyen, ""Lan"""/);
  assert.equal(csv.split('\n').length, 2); // header + one row, no stray newline
});

test('a formula in a lead-supplied field is neutralised', () => {
  // `name` comes straight from a public form. Without this, opening the export
  // in Excel executes whatever the lead typed.
  const csv = leadsToCsv([{ ...LEAD, name: '=cmd|"/c calc"!A0' }]);
  assert.match(csv, /'=cmd/);
  assert.doesNotMatch(csv, /(^|,)=cmd/m);
});

test('a phone number keeps its digits even when quoted for safety', () => {
  const csv = leadsToCsv([{ ...LEAD, whatsapp: '+84901234567' }]);
  assert.match(csv, /84901234567/);
});

test('nulls render as empty cells rather than the word null', () => {
  const csv = leadsToCsv([{ ...LEAD, name: null, whatsapp: null, house: null }]);
  assert.doesNotMatch(csv.split('\n')[1], /null/);
});

test('an empty list still produces a usable header row', () => {
  assert.equal(leadsToCsv([]), CSV_HEADER);
});
