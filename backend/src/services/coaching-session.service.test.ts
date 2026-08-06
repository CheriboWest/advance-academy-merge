import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseBooking } from './coaching-session.service.js';

/**
 * Intake validation. It has one job the student can feel: when a booking is
 * rejected, the message must name the thing to fix, because the form shows it
 * verbatim. "Invalid request" would send them back to guess.
 *
 * It deliberately does NOT judge quality — a forty-character JD passes here and
 * gets flagged by Stage 0 instead. Intake asks "is this a booking?"; readiness
 * asks "is this enough?". Merging them would mean rejecting bookings a coach
 * could easily have rescued.
 */

const FULL_JD =
  'Data Analyst, London. Own commercial reporting, build dashboards, partner with finance.';

function booking(over: Record<string, unknown> = {}) {
  return { companyName: 'Acme', jdText: FULL_JD, ...over } as never;
}

test('a minimal valid booking normalises', () => {
  const out = normaliseBooking(booking());
  assert.equal(out.companyName, 'Acme');
  assert.equal(out.sessionType, 'interview_prep');
  assert.equal(out.jdText, FULL_JD);
  assert.deepEqual(out.proposedSlots, []);
  assert.equal(out.interviewAt, null);
});

test('a missing company is rejected by name, not by code', () => {
  assert.throws(
    () => normaliseBooking(booking({ companyName: '   ' })),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 422);
      assert.match(err.message, /company/i);
      return true;
    },
  );
});

test('a missing or stub JD is rejected', () => {
  for (const jdText of ['', '   ', 'Data Analyst']) {
    assert.throws(
      () => normaliseBooking(booking({ jdText })),
      (err: Error & { statusCode?: number }) => {
        assert.equal(err.statusCode, 422);
        assert.match(err.message, /job description/i);
        return true;
      },
    );
  }
});

test('an unknown session type is rejected', () => {
  assert.throws(() => normaliseBooking(booking({ sessionType: 'salary_negotiation' })), /sessionType/);
});

test('optional fields become null rather than empty strings', () => {
  // Null reads as "not answered" everywhere downstream; '' would count as
  // answered and quietly suppress the Stage 0 gap that asks for it.
  const out = normaliseBooking(booking({ stage: '  ', interviewerRole: '', worryText: undefined }));
  assert.equal(out.stage, null);
  assert.equal(out.interviewerRole, null);
  assert.equal(out.worryText, null);
});

test('dates are normalised to ISO', () => {
  const out = normaliseBooking(booking({ interviewAt: '2026-09-01T09:30:00Z' }));
  assert.equal(out.interviewAt, '2026-09-01T09:30:00.000Z');
});

test('an unparseable date names which field is wrong', () => {
  assert.throws(
    () => normaliseBooking(booking({ interviewAt: 'next tuesday-ish' })),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 422);
      assert.match(err.message, /Interview date/);
      return true;
    },
  );
  assert.throws(
    () => normaliseBooking(booking({ proposedSlots: ['2026-09-01T09:00:00Z', 'whenever'] })),
    /Time slot 2/,
  );
});

test('too many proposed slots is rejected', () => {
  const many = Array.from({ length: 6 }, (_, i) => `2026-09-0${i + 1}T09:00:00Z`);
  assert.throws(() => normaliseBooking(booking({ proposedSlots: many })), /at most 5/);
});

test('proposed slots are normalised and kept in order', () => {
  const out = normaliseBooking(
    booking({ proposedSlots: ['2026-09-01T09:00:00Z', '2026-09-02T14:00:00+01:00'] }),
  );
  assert.deepEqual(out.proposedSlots, ['2026-09-01T09:00:00.000Z', '2026-09-02T13:00:00.000Z']);
});

test('oversized text is capped rather than rejected', () => {
  // A pasted JD with a whole careers page attached is a normal accident, not an
  // attack. Truncating keeps the booking; rejecting would lose their typing.
  const out = normaliseBooking(booking({ companyName: 'A'.repeat(500), worryText: 'w'.repeat(5000) }));
  assert.equal(out.companyName.length, 200);
  assert.equal(out.worryText?.length, 2000);
});
