import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toStudentContact, toSummary } from './company-contacts.service.js';

test('toSummary: counts per category, nothing personal', () => {
  const summary = toSummary([{ job_title: 'HR Manager' }, { job_title: 'Talent Partner' }, { job_title: 'Recruiter' }, { job_title: null }]);
  assert.deepEqual(summary, { total: 4, byCategory: { hr: 1, recruiter: 2, other: 1 } });
});

test('toStudentContact: phone and coach notes never reach a student', () => {
  const row = {
    id: 'c1', full_name: 'Sam Lee', job_title: 'Head of Talent', email: 's@x.com', linkedin_url: null,
    phone: '+44 7700 900000', notes: 'Prefers calls on Fridays',
  };
  const contact = toStudentContact(row);
  assert.equal(contact.category, 'recruiter');
  assert.ok(!('phone' in contact) && !('notes' in contact));
});
