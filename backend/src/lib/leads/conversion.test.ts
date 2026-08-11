import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertedLeadIds } from './conversion.js';

/**
 * The "Account" column on /admin/leads and the conversion percentage above it.
 * Both keys have to work at once: migration 022 links new leads explicitly, and
 * everything captured before it still only has an email to go on.
 */

const LEADS = [
  { id: 'lead-a', email: 'lan@example.com' },
  { id: 'lead-b', email: 'minh@example.com' },
  { id: 'lead-c', email: 'hoa@example.com' },
];

test('an explicit lead_id link counts as converted', () => {
  const converted = convertedLeadIds(LEADS, { leadIds: ['lead-b'], emails: [] });
  assert.deepEqual([...converted], ['lead-b']);
});

test('a pre-022 lead still converts on the email fallback', () => {
  // Without this, shipping 022 would make every existing lead read as
  // "never signed up" until the backfill ran.
  const converted = convertedLeadIds(LEADS, { leadIds: [], emails: ['lan@example.com'] });
  assert.deepEqual([...converted], ['lead-a']);
});

test('email matching ignores casing and surrounding space on both sides', () => {
  const converted = convertedLeadIds([{ id: 'lead-a', email: '  Lan@Example.COM ' }], {
    leadIds: [],
    emails: [' LAN@example.com'],
  });
  assert.equal(converted.has('lead-a'), true);
});

test('the two keys together do not double-count or miss', () => {
  const converted = convertedLeadIds(LEADS, {
    leadIds: ['lead-a'],
    emails: ['minh@example.com'],
  });
  assert.deepEqual([...converted].sort(), ['lead-a', 'lead-b']);
});

test('an account whose email drifted from the lead still counts via lead_id', () => {
  // The failure 022 exists to prevent: the migration 006 trigger only fires on
  // INSERT, so public.users.email can go stale against the address on the lead.
  const converted = convertedLeadIds([{ id: 'lead-a', email: 'old@example.com' }], {
    leadIds: ['lead-a'],
    emails: ['new@example.com'],
  });
  assert.equal(converted.has('lead-a'), true);
});

test('leads with no account are absent, not false-positive', () => {
  const converted = convertedLeadIds(LEADS, { leadIds: [], emails: [] });
  assert.equal(converted.size, 0);
});

test('nulls from either side are ignored rather than matching each other', () => {
  // Two leads with no email must not both match an account row with a null one.
  const converted = convertedLeadIds(
    [
      { id: 'lead-a', email: '' },
      { id: 'lead-b', email: '   ' },
    ],
    { leadIds: [null, undefined], emails: [null, '', undefined] },
  );
  assert.equal(converted.size, 0);
});

test('two leads sharing an address are judged separately by id', () => {
  // candidate_leads is unique on (email, source), so one person can be several
  // rows. Only the one actually linked should read as converted.
  const shared = [
    { id: 'lead-quiz', email: 'lan@example.com' },
    { id: 'lead-other', email: 'lan@example.com' },
  ];
  const byId = convertedLeadIds(shared, { leadIds: ['lead-quiz'], emails: [] });
  assert.deepEqual([...byId], ['lead-quiz']);

  // On the email fallback alone they are indistinguishable — both convert. That
  // is the imprecision 022 removes, recorded here so the difference is visible.
  const byEmail = convertedLeadIds(shared, { leadIds: [], emails: ['lan@example.com'] });
  assert.equal(byEmail.size, 2);
});
