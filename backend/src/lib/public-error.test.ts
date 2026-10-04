import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicErrorMessage } from './public-error.js';

const FALLBACK = 'Unavailable right now.';
const own = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

test('publicErrorMessage: our own 4xx message reaches the student', () => {
  assert.equal(publicErrorMessage(own(400, 'Paste the job description.'), FALLBACK), 'Paste the job description.');
  assert.equal(publicErrorMessage(own(429, 'You need 1 credit.'), FALLBACK), 'You need 1 credit.');
});

test('publicErrorMessage: server and provider errors never do', () => {
  assert.equal(publicErrorMessage(own(500, 'Failed to list jobs: relation missing'), FALLBACK), FALLBACK);
  assert.equal(publicErrorMessage(own(503, 'LLM_API_KEY is not set in backend/.env'), FALLBACK), FALLBACK);
  // Anthropic SDK shape: `status`, raw JSON message.
  const sdk = Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error"}}'), { status: 401 });
  assert.equal(publicErrorMessage(sdk, FALLBACK), FALLBACK);
  assert.equal(publicErrorMessage(new Error('boom'), FALLBACK), FALLBACK);
  assert.equal(publicErrorMessage('boom', FALLBACK), FALLBACK);
});
