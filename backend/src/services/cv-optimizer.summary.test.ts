import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cvSummary } from './cv-optimizer.service.js';

/**
 * The label a CV Optimiser run carries in "My history". A student who analyses
 * the same target role twice — once cold, once against a specific JD — would
 * otherwise see two identical rows and have to open both to tell them apart.
 */

test('the target role is the label', () => {
  assert.equal(cvSummary({ targetRole: 'Data Analyst', currentCvText: 'cv' }), 'Data Analyst');
});

test('a run against a JD is distinguishable from one without', () => {
  const withJd = cvSummary({
    targetRole: 'Data Analyst',
    currentCvText: 'cv',
    jobDescription: 'We are hiring a data analyst...',
  });
  assert.equal(withJd, 'Data Analyst · against a JD');
  assert.notEqual(withJd, cvSummary({ targetRole: 'Data Analyst', currentCvText: 'cv' }));
});

test('whitespace-only fields are treated as absent', () => {
  assert.equal(
    cvSummary({ targetRole: 'Data Analyst', currentCvText: 'cv', jobDescription: '   ' }),
    'Data Analyst',
  );
  assert.equal(cvSummary({ targetRole: '  ', currentCvText: 'cv' }), 'CV Optimiser');
});

test('a missing role still produces a readable row', () => {
  assert.equal(cvSummary({ targetRole: '', currentCvText: 'cv' }), 'CV Optimiser');
});
