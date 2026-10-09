import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCvIntoParts, deriveRewriteSuggestions } from './bullets.agent.js';
import type { BulletEvaluation } from '@advance-academy/contracts/cv-optimizer';

const cv = ['HEADER', 'Role A\n- a1\n- a2', 'Role B\n- b1\n- b2', 'Role C\n- c1', 'SKILLS'].join('\n\n');

test('splitCvIntoParts: every block lands in exactly one part, in order', () => {
  const parts = splitCvIntoParts(cv, 3);
  assert.ok(parts.length > 1 && parts.length <= 3);
  assert.equal(parts.join('\n\n'), cv);
});

test('splitCvIntoParts: one part, or no blank lines, keeps the CV whole', () => {
  assert.deepEqual(splitCvIntoParts(cv, 1), [cv]);
  assert.deepEqual(splitCvIntoParts('a\nb\nc', 3), ['a\nb\nc']);
});

test('deriveRewriteSuggestions: weakest rewritten bullets first, capped at 6', () => {
  const b = (original: string, impactScore: number, autoRewrite = 'better'): BulletEvaluation => ({
    original, project: 'P', hasImpact: false, impactScore, feedback: 'f', autoRewrite, clarifyingQuestions: [],
  });
  const out = deriveRewriteSuggestions([b('x', 5), b('strong', 8, ''), b('y', 2), ...[3, 4, 4, 5, 6].map((s, i) => b(`z${i}`, s))]);
  assert.equal(out.length, 6);
  assert.equal(out[0].current, 'y');
  assert.ok(out.every((s) => s.current !== 'strong'));
});
