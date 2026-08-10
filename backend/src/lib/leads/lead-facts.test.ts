import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactability, readQuizResult, whatsappDigits } from './lead-facts.js';

/**
 * `candidate_leads.result` is written by a service in another repo. These tests
 * are the contract we assume about it — and, more importantly, the guarantee
 * that a change over there degrades a column rather than breaking the page.
 */

const QUIZ_PAYLOAD = { house: 'AO', scoreBreakdown: 'SG:2 AO:5 CC:1', whatsapp: '+44 7700 900123' };

test('the quiz payload yields phone, house and score', () => {
  const facts = readQuizResult(QUIZ_PAYLOAD);
  assert.equal(facts.whatsapp, '+44 7700 900123');
  assert.equal(facts.whatsappDigits, '447700900123');
  assert.equal(facts.house, 'AO');
  assert.equal(facts.scoreBreakdown, 'SG:2 AO:5 CC:1');
});

test('a missing or malformed result never throws', () => {
  for (const bad of [null, undefined, 'a string', 42, [], [{ whatsapp: '1' }]]) {
    const facts = readQuizResult(bad);
    assert.equal(facts.whatsapp, null);
    assert.equal(facts.house, null);
  }
});

test('unexpected field types are treated as absent, not coerced', () => {
  // `String(1234567)` would look like a plausible phone number. It is not one.
  const facts = readQuizResult({ whatsapp: 1234567, house: { id: 'AO' }, scoreBreakdown: null });
  assert.equal(facts.whatsapp, null);
  assert.equal(facts.house, null);
  assert.equal(facts.scoreBreakdown, null);
});

test('a lead magnet that sends no phone still parses', () => {
  const facts = readQuizResult({ house: 'PL' });
  assert.equal(facts.house, 'PL');
  assert.equal(facts.whatsapp, null);
  assert.equal(facts.whatsappDigits, null);
});

test('phone punctuation is stripped for the wa.me link', () => {
  assert.equal(whatsappDigits('(084) 90-123 4567'), '084901234567');
  assert.equal(whatsappDigits('+84 90 123 4567'), '84901234567');
});

test('values outside phone-number length are rejected rather than linked', () => {
  assert.equal(whatsappDigits('12345'), null); // too short to be any number
  assert.equal(whatsappDigits('1234567890123456'), null); // past E.164's 15
  assert.equal(whatsappDigits('n/a'), null);
  assert.equal(whatsappDigits(null), null);
});

/* ── Contactability: the rules that decide whether we may email someone ── */

const OPTED_IN = { status: 'new', consent_marketing: true, double_optin: false, has_account: false };

test('an unsubscribe overrides an earlier opt-in', () => {
  const v = contactability({ ...OPTED_IN, status: 'unsub', double_optin: true, has_account: true });
  assert.equal(v.contactable, 'no');
  assert.match(v.reason, /Unsubscribed/);
});

test('no opt-in is decisive however far they got', () => {
  const v = contactability({ ...OPTED_IN, consent_marketing: false, has_account: true });
  assert.equal(v.contactable, 'no');
});

test('a confirmed double opt-in is contactable', () => {
  assert.equal(contactability({ ...OPTED_IN, double_optin: true }).contactable, 'yes');
});

test('a quiz lead who signed in via the magic link counts as confirmed', () => {
  // The case that makes this column useful at all: quiz leads are sent a magic
  // login link INSTEAD of the confirm email, so double_optin stays false for
  // them forever. Without this rule every quiz lead reads as unverified.
  const v = contactability({ ...OPTED_IN, has_account: true });
  assert.equal(v.contactable, 'yes');
  assert.match(v.reason, /magic link/);
});

test('opted in but unproven is pending, not a yes and not a no', () => {
  const v = contactability(OPTED_IN);
  assert.equal(v.contactable, 'pending');
  assert.match(v.reason, /unproven/);
});
