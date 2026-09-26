import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jobUrlKey,
  validateChangeJobStatus,
  validateCreateSavedJob,
  validateUpdateSavedJob,
} from './job-tracking.js';

test('jobUrlKey: ignores case, query, fragment and trailing slash', () => {
  const a = jobUrlKey('https://www.Reed.co.uk/jobs/data-analyst/123/?source=x#top');
  const b = jobUrlKey('https://www.reed.co.uk/jobs/data-analyst/123');
  assert.equal(a, 'www.reed.co.uk/jobs/data-analyst/123');
  assert.equal(a, b);
});

test('jobUrlKey: distinct paths stay distinct', () => {
  assert.notEqual(jobUrlKey('https://x.com/jobs/1'), jobUrlKey('https://x.com/jobs/2'));
});

test('jobUrlKey: empty or unparseable input yields null (no collision)', () => {
  assert.equal(jobUrlKey(''), null);
  assert.equal(jobUrlKey(null), null);
  assert.equal(jobUrlKey('not a url'), null);
});

test('validateCreateSavedJob: title is required and trimmed', () => {
  assert.equal(validateCreateSavedJob({}).ok, false);
  assert.equal(validateCreateSavedJob({ title: '   ' }).ok, false);
  const ok = validateCreateSavedJob({ title: '  Data Analyst ' });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.value.title, 'Data Analyst');
});

test('validateCreateSavedJob: rejects non-http links and bad dates', () => {
  assert.equal(validateCreateSavedJob({ title: 'x', jobUrl: 'javascript:alert(1)' }).ok, false);
  assert.equal(validateCreateSavedJob({ title: 'x', jobUrl: 'nope' }).ok, false);
  assert.equal(validateCreateSavedJob({ title: 'x', deadlineAt: '12/09/2026' }).ok, false);
  assert.equal(validateCreateSavedJob({ title: 'x', deadlineAt: '2026-09-12' }).ok, true);
});

test('validateCreateSavedJob: empty optional strings become null, unknown source rejected', () => {
  const ok = validateCreateSavedJob({ title: 'x', companyName: '', source: 'dream_company' });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.companyName, null);
    assert.equal(ok.value.source, 'dream_company');
  }
  assert.equal(validateCreateSavedJob({ title: 'x', source: 'linkedin' }).ok, false);
});

test('validateUpdateSavedJob: keeps only the fields sent, refuses an empty patch', () => {
  const ok = validateUpdateSavedJob({ notes: 'call back', nextFollowUpAt: '2026-09-20' });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { notes: 'call back', nextFollowUpAt: '2026-09-20' });
  assert.equal(validateUpdateSavedJob({}).ok, false);
  assert.equal(validateUpdateSavedJob({ title: '' }).ok, false);
});

test('validateUpdateSavedJob: null clears a date, appliedAt is normalised to ISO', () => {
  const ok = validateUpdateSavedJob({ nextFollowUpAt: null, appliedAt: '2026-09-10T08:00:00+07:00' });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.nextFollowUpAt, null);
    assert.equal(ok.value.appliedAt, '2026-09-10T01:00:00.000Z');
  }
});

test('validateChangeJobStatus: only known statuses pass', () => {
  assert.equal(validateChangeJobStatus({ status: 'interview' }).ok, true);
  assert.equal(validateChangeJobStatus({ status: 'ghosted' }).ok, false);
  assert.equal(validateChangeJobStatus({}).ok, false);
});

test('validateUpdateSavedJob: cvVersionId must be an id, cover letter is capped', () => {
  const id = '0b8e4f6a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
  const ok = validateUpdateSavedJob({ cvVersionId: id, coverLetterText: ' Dear Hiring Manager ' });
  assert.deepEqual(ok, { ok: true, value: { cvVersionId: id, coverLetterText: 'Dear Hiring Manager' } });
  assert.equal(validateUpdateSavedJob({ cvVersionId: 'not-an-id' }).ok, false);
  assert.equal(validateUpdateSavedJob({ coverLetterText: 'x'.repeat(10001) }).ok, false);
  assert.deepEqual(validateUpdateSavedJob({ cvVersionId: null }), { ok: true, value: { cvVersionId: null } });
});
