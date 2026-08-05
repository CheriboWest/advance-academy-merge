import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalError } from './user-access.js';

test('approvalError: approved accounts pass', () => {
  assert.equal(approvalError('approved'), null);
});

test('approvalError: pending accounts are blocked with ACCOUNT_PENDING', () => {
  assert.equal(approvalError('pending')?.code, 'ACCOUNT_PENDING');
});

test('approvalError: rejected accounts are blocked with ACCOUNT_REJECTED', () => {
  assert.equal(approvalError('rejected')?.code, 'ACCOUNT_REJECTED');
});

test('approvalError: fails closed on an unrecognised status', () => {
  // A bad DB value, or a row the migration never touched, must not grant access.
  assert.equal(approvalError('' as never)?.code, 'ACCOUNT_PENDING');
  assert.equal(approvalError(undefined as never)?.code, 'ACCOUNT_PENDING');
});
