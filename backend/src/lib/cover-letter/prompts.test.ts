import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverLetterUserMessage, shouldFetchJd } from './prompts.js';

test('shouldFetchJd: thin description with a link fetches', () => {
  assert.equal(shouldFetchJd('Data Analyst, London', 'https://example.com/job/1'), true);
  assert.equal(shouldFetchJd(null, 'https://example.com/job/1'), true);
});

test('shouldFetchJd: no link means nothing to fetch', () => {
  assert.equal(shouldFetchJd('short', null), false);
  assert.equal(shouldFetchJd('short', '   '), false);
});

test('shouldFetchJd: a full description is used as is', () => {
  assert.equal(shouldFetchJd('x'.repeat(400), 'https://example.com/job/1'), false);
});

test('buildCoverLetterUserMessage: carries role, company, JD and CV', () => {
  const msg = buildCoverLetterUserMessage({
    cvText: 'Jane Doe — SQL, Python',
    jobTitle: 'Data Analyst',
    companyName: 'Acme',
    jobDescription: 'We need SQL.',
  });
  assert.match(msg, /Role: Data Analyst/);
  assert.match(msg, /Company: Acme/);
  assert.match(msg, /We need SQL\./);
  assert.match(msg, /Jane Doe/);
});

test('buildCoverLetterUserMessage: missing company is said out loud, not left blank', () => {
  const msg = buildCoverLetterUserMessage({
    cvText: 'cv',
    jobTitle: 'Analyst',
    companyName: null,
    jobDescription: 'jd',
  });
  assert.match(msg, /Company: Not stated/);
});
