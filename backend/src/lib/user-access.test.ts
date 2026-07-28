import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalError } from './user-access.js';

test('approvalError: approved accounts pass', () => {
  assert.equal(approvalError({ status: 'approved' }), null);
});

test('approvalError: pending accounts are blocked with ACCOUNT_PENDING', () => {
  assert.equal(approvalError({ status: 'pending' })?.code, 'ACCOUNT_PENDING');
});

test('approvalError: rejected accounts are blocked with ACCOUNT_REJECTED', () => {
  assert.equal(approvalError({ status: 'rejected' })?.code, 'ACCOUNT_REJECTED');
});

test('approvalError: fails closed on an unrecognised status', () => {
  // A bad DB value, or a row the migration never touched, must not grant access.
  assert.equal(approvalError({ status: '' as never })?.code, 'ACCOUNT_PENDING');
  assert.equal(approvalError({ status: undefined as never })?.code, 'ACCOUNT_PENDING');
});
