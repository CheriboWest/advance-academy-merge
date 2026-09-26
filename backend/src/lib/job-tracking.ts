import {
  isJobSource,
  isSavedJobStatus,
  type ChangeJobStatusRequest,
  type CreateSavedJobRequest,
  type UpdateSavedJobRequest,
} from '@advance-academy/contracts/job-tracking';

/**
 * Pure helpers for the job tracker: URL normalisation and request validation.
 * No I/O here so they can be unit-tested with node:test alone. The service
 * layer (`services/job-tracking.service.ts`) does the Supabase work.
 */

const MAX_SHORT = 200;
const MAX_URL = 2000;
const MAX_LONG = 5000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A cover letter is ~400 words; this leaves room for a long one without storing an essay. */
const MAX_LETTER = 10000;

/**
 * Identity of a job link for duplicate detection (AC7): lowercase host + path,
 * query string, fragment and trailing slashes dropped. Same rule as
 * `dedupeJobs` in job-search.service.ts so a card saved from Dream Company and
 * the same posting pasted by hand collide the way the user expects.
 * Returns null for an empty or unparseable URL — those cards never collide.
 */
export function jobUrlKey(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.host.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return null;
  }
}

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

function fail<T>(message: string): Validation<T> {
  return { ok: false, message };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Trim a string field; `null`/`''` become null. Anything non-string is rejected. */
function optionalText(
  body: Record<string, unknown>,
  key: string,
  max: number,
): Validation<string | null | undefined> {
  if (!(key in body)) return { ok: true, value: undefined };
  const raw = body[key];
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return fail(`${key} must be a string.`);
  const trimmed = raw.trim();
  if (trimmed.length > max) return fail(`${key} must be ${max} characters or fewer.`);
  return { ok: true, value: trimmed || null };
}

function optionalDay(body: Record<string, unknown>, key: string): Validation<string | null | undefined> {
  const text = optionalText(body, key, 10);
  if (!text.ok) return text;
  if (text.value == null) return text;
  if (!DAY_RE.test(text.value) || Number.isNaN(Date.parse(text.value))) {
    return fail(`${key} must be a date in YYYY-MM-DD format.`);
  }
  return text;
}

function optionalInstant(body: Record<string, unknown>, key: string): Validation<string | null | undefined> {
  const text = optionalText(body, key, 40);
  if (!text.ok) return text;
  if (text.value == null) return text;
  const ms = Date.parse(text.value);
  if (Number.isNaN(ms)) return fail(`${key} must be an ISO 8601 timestamp.`);
  return { ok: true, value: new Date(ms).toISOString() };
}

function optionalUrl(body: Record<string, unknown>, key: string): Validation<string | null | undefined> {
  const text = optionalText(body, key, MAX_URL);
  if (!text.ok) return text;
  if (text.value == null) return text;
  let parsed: URL;
  try {
    parsed = new URL(text.value);
  } catch {
    return fail('jobUrl must be a valid http(s) link.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail('jobUrl must be a valid http(s) link.');
  }
  return { ok: true, value: parsed.toString() };
}

function optionalUuid(body: Record<string, unknown>, key: string): Validation<string | null | undefined> {
  const text = optionalText(body, key, 36);
  if (!text.ok) return text;
  if (text.value == null) return text;
  if (!UUID_RE.test(text.value)) return fail(`${key} must be an id.`);
  return text;
}

function optionalBool(body: Record<string, unknown>, key: string): Validation<boolean | null | undefined> {
  if (!(key in body)) return { ok: true, value: undefined };
  const raw = body[key];
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'boolean') return fail(`${key} must be true, false or null.`);
  return { ok: true, value: raw };
}

type Collected<T> = Validation<T>;

/**
 * Run a set of field validators and either collect the values into one object
 * (dropping `undefined` so PATCH leaves untouched columns alone) or return the
 * first failure.
 */
function collect<T extends object>(
  fields: Record<string, Validation<unknown>>,
): Collected<T> {
  const out: Record<string, unknown> = {};
  for (const [key, result] of Object.entries(fields)) {
    if (!result.ok) return fail(result.message);
    if (result.value !== undefined) out[key] = result.value;
  }
  return { ok: true, value: out as T };
}

export type ValidCreate = Required<Pick<CreateSavedJobRequest, 'title'>> &
  Omit<CreateSavedJobRequest, 'title'>;

export function validateCreateSavedJob(body: unknown): Validation<ValidCreate> {
  if (!isRecord(body)) return fail('Request body must be an object.');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return fail('title is required.');
  if (title.length > MAX_SHORT) return fail(`title must be ${MAX_SHORT} characters or fewer.`);

  let source: Validation<unknown> = { ok: true, value: undefined };
  if ('source' in body && body.source !== undefined) {
    source = isJobSource(body.source) ? { ok: true, value: body.source } : fail('source is not recognised.');
  }

  const rest = collect<Omit<ValidCreate, 'title'>>({
    companyName: optionalText(body, 'companyName', MAX_SHORT),
    location: optionalText(body, 'location', MAX_SHORT),
    jobUrl: optionalUrl(body, 'jobUrl'),
    description: optionalText(body, 'description', MAX_LONG),
    salaryText: optionalText(body, 'salaryText', 100),
    sponsorVisa: optionalBool(body, 'sponsorVisa'),
    deadlineAt: optionalDay(body, 'deadlineAt'),
    nextFollowUpAt: optionalDay(body, 'nextFollowUpAt'),
    notes: optionalText(body, 'notes', MAX_LONG),
    source,
  });
  if (!rest.ok) return rest;
  return { ok: true, value: { title, ...rest.value } };
}

export function validateUpdateSavedJob(body: unknown): Validation<UpdateSavedJobRequest> {
  if (!isRecord(body)) return fail('Request body must be an object.');

  let title: Validation<unknown> = { ok: true, value: undefined };
  if ('title' in body) {
    const t = typeof body.title === 'string' ? body.title.trim() : '';
    title = !t
      ? fail('title cannot be empty.')
      : t.length > MAX_SHORT
        ? fail(`title must be ${MAX_SHORT} characters or fewer.`)
        : { ok: true, value: t };
  }

  const patch = collect<UpdateSavedJobRequest>({
    title,
    companyName: optionalText(body, 'companyName', MAX_SHORT),
    location: optionalText(body, 'location', MAX_SHORT),
    jobUrl: optionalUrl(body, 'jobUrl'),
    description: optionalText(body, 'description', MAX_LONG),
    salaryText: optionalText(body, 'salaryText', 100),
    sponsorVisa: optionalBool(body, 'sponsorVisa'),
    notes: optionalText(body, 'notes', MAX_LONG),
    appliedAt: optionalInstant(body, 'appliedAt'),
    deadlineAt: optionalDay(body, 'deadlineAt'),
    nextFollowUpAt: optionalDay(body, 'nextFollowUpAt'),
    cvVersionId: optionalUuid(body, 'cvVersionId'),
    coverLetterText: optionalText(body, 'coverLetterText', MAX_LETTER),
  });
  if (!patch.ok) return patch;
  if (Object.keys(patch.value).length === 0) return fail('Nothing to update.');
  return patch;
}

export function validateChangeJobStatus(body: unknown): Validation<ChangeJobStatusRequest> {
  if (!isRecord(body)) return fail('Request body must be an object.');
  if (!isSavedJobStatus(body.status)) return fail('status is not recognised.');
  const note = optionalText(body, 'note', MAX_LONG);
  if (!note.ok) return note;
  return { ok: true, value: { status: body.status, note: note.value ?? null } };
}
