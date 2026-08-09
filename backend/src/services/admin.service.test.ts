import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planUserUpdate, type AdminUserRow, type Grants } from './admin.service.js';

/**
 * `/admin/users` is the only place a signup gets approved and the only place a
 * coaching session can be granted by hand, so its rules are worth pinning down:
 * a tier upgrade tops balances UP TO the grant instead of adding to them (else
 * toggling the tier farms credits), deltas never drive a balance negative, and
 * every audit action stays inside the DB's CHECK constraint.
 */

const GRANTS: Grants = { credits: 20, sessions: 1 };
const NOW = '2026-08-08T00:00:00.000Z';
const ACTOR = 'actor-uuid';

/** Actions `admin_actions_action_check` accepts after migration 020. */
const ALLOWED_AUDIT_ACTIONS = new Set([
  'set_tier',
  'adjust_credits',
  'set_admin',
  'set_status',
  'adjust_coaching',
]);

function user(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: 'target-uuid',
    email: 'student@example.com',
    full_name: 'A Student',
    status: 'pending',
    tier: 'trial',
    is_admin: false,
    credit_balance: 2,
    coaching_credits: 0,
    referral_count: 0,
    first_tool_used_at: null,
    reviewed_at: null,
    created_at: NOW,
    ...overrides,
  };
}

const plan = (current: AdminUserRow, patch: Parameters<typeof planUserUpdate>[1]) =>
  planUserUpdate(current, patch, ACTOR, GRANTS, NOW);

test('approving stamps the reviewer and the time', () => {
  const { updates, audits } = plan(user(), { status: 'approved' });
  assert.equal(updates.status, 'approved');
  assert.equal(updates.reviewed_at, NOW);
  assert.equal(updates.reviewed_by, ACTOR);
  assert.deepEqual(audits[0], {
    action: 'set_status',
    detail: { from: 'pending', to: 'approved' },
  });
});

test('re-approving an approved account changes nothing', () => {
  const { updates, audits } = plan(user({ status: 'approved' }), { status: 'approved' });
  assert.deepEqual(updates, {});
  assert.equal(audits.length, 0);
});

test('upgrading to membership grants both the wallet and one coaching session', () => {
  const { updates, audits } = plan(user(), { tier: 'membership' });
  assert.equal(updates.tier, 'membership');
  assert.equal(updates.credit_balance, 20);
  assert.equal(updates.coaching_credits, 1);
  assert.deepEqual(audits[0].detail, {
    from: 'trial',
    to: 'membership',
    granted: 18,
    coachingGranted: 1,
  });
});

test('a balance already above the grant is left alone', () => {
  // An inviter who earned past the grant through referrals must not be cut back.
  const { updates } = plan(user({ credit_balance: 35, coaching_credits: 3 }), {
    tier: 'membership',
  });
  assert.equal('credit_balance' in updates, false);
  assert.equal('coaching_credits' in updates, false);
});

test('toggling the tier back and forth cannot farm coaching sessions', () => {
  // Downgrade leaves the session in place, so the re-upgrade must not grant again.
  const afterFirstUpgrade = user({ tier: 'membership', coaching_credits: 1, credit_balance: 20 });
  const downgrade = plan(afterFirstUpgrade, { tier: 'trial' });
  assert.equal('coaching_credits' in downgrade.updates, false);

  const reUpgrade = plan(user({ tier: 'trial', coaching_credits: 1, credit_balance: 20 }), {
    tier: 'membership',
  });
  assert.equal('coaching_credits' in reUpgrade.updates, false);
  assert.equal(reUpgrade.audits[0].detail.coachingGranted, undefined);
});

test('a coaching top-up stacks on a grant made in the same request', () => {
  const { updates, audits } = plan(user(), { tier: 'membership', coachingDelta: 2 });
  assert.equal(updates.coaching_credits, 3); // 1 granted + 2 added
  assert.deepEqual(
    audits.map((a) => a.action),
    ['set_tier', 'adjust_coaching'],
  );
});

test('neither quota can be driven negative', () => {
  const { updates } = plan(user({ credit_balance: 1, coaching_credits: 1 }), {
    creditDelta: -5,
    coachingDelta: -5,
  });
  assert.equal(updates.credit_balance, 0);
  assert.equal(updates.coaching_credits, 0);
});

test('a missing coaching_credits column reads as zero, not NaN', () => {
  // A row read through the pre-019 fallback has no such field.
  const legacy = user();
  delete (legacy as Partial<AdminUserRow>).coaching_credits;
  const { updates } = plan(legacy, { coachingDelta: 1 });
  assert.equal(updates.coaching_credits, 1);
});

test('an empty patch produces no write', () => {
  const { updates, audits } = plan(user(), {});
  assert.deepEqual(updates, {});
  assert.equal(audits.length, 0);
});

test('every audit action is one the DB constraint accepts', () => {
  // Guards against the drift that already bit once: migration 018 narrowed the
  // CHECK and quietly dropped 'adjust_coaching' until migration 020 restored it.
  const { audits } = plan(user(), {
    status: 'approved',
    tier: 'membership',
    creditDelta: 5,
    coachingDelta: 1,
    isAdmin: true,
  });
  assert.equal(audits.length, 5);
  for (const a of audits) {
    assert.ok(ALLOWED_AUDIT_ACTIONS.has(a.action), `unknown audit action: ${a.action}`);
  }
});
