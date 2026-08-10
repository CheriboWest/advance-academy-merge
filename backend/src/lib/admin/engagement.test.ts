import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachEngagement, indexEngagement, NO_ENGAGEMENT } from './engagement.js';

/**
 * The join between a page of accounts and the engagement RPC. The case that
 * matters is the missing row: the RPC omits accounts with no activity, and
 * reading that as "unknown" would put a blank where the true answer — zero — is
 * exactly what the admin is looking for.
 */

const USERS = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }];

test('an account with no RPC row reads as zero, not unknown', () => {
  const attached = attachEngagement(USERS, indexEngagement([]));
  assert.equal(attached.length, 3);
  for (const u of attached) {
    assert.equal(u.events_30d, 0);
    assert.equal(u.total_events, 0);
    assert.equal(u.last_active_at, null);
  }
});

test('engagement lands on the right account', () => {
  const attached = attachEngagement(
    USERS,
    indexEngagement([
      { user_id: 'u2', last_active_at: '2026-08-01T00:00:00Z', events_30d: 4, total_events: 9 },
    ]),
  );
  assert.deepEqual(attached.map((u) => u.events_30d), [0, 4, 0]);
  assert.equal(attached[1].total_events, 9);
  assert.equal(attached[0].last_active_at, null);
});

test('list order survives the join', () => {
  // The list is already sorted by signup date; the RPC groups in its own order.
  const attached = attachEngagement(
    USERS,
    indexEngagement([
      { user_id: 'u3', last_active_at: null, events_30d: 1, total_events: 1 },
      { user_id: 'u1', last_active_at: null, events_30d: 2, total_events: 2 },
    ]),
  );
  assert.deepEqual(attached.map((u) => u.id), ['u1', 'u2', 'u3']);
});

test('the original account fields are kept', () => {
  const attached = attachEngagement(
    [{ id: 'u1', email: 'a@b.c', tier: 'trial' }],
    indexEngagement([{ user_id: 'u1', last_active_at: null, events_30d: 1, total_events: 1 }]),
  );
  assert.equal(attached[0].email, 'a@b.c');
  assert.equal(attached[0].tier, 'trial');
});

test('a null or missing RPC result degrades to zeroes rather than throwing', () => {
  // This is the migration-not-applied path: the backend swallows the RPC error
  // and passes nothing here, and the page must still render.
  for (const rows of [null, undefined, []]) {
    const attached = attachEngagement(USERS, indexEngagement(rows));
    assert.deepEqual(attached[0], { id: 'u1', ...NO_ENGAGEMENT });
  }
});

test('junk counts from the JSON boundary render as zero, never NaN', () => {
  const map = indexEngagement([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { user_id: 'u1', last_active_at: null, events_30d: null, total_events: undefined as any },
  ]);
  assert.equal(map.get('u1')!.events_30d, 0);
  assert.equal(map.get('u1')!.total_events, 0);
});

test('rows without a user id are skipped rather than keyed under undefined', () => {
  const map = indexEngagement([
    { user_id: '', last_active_at: null, events_30d: 5, total_events: 5 },
    { user_id: 'u1', last_active_at: null, events_30d: 1, total_events: 1 },
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get('u1')!.events_30d, 1);
});
