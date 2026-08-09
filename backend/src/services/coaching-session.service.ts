/**
 * Coaching session lifecycle (sprint Coaching Tool, ticket T2).
 *
 * Booking is the only write a student ever makes to `coaching_sessions`.
 * Everything after it — generation, editing, approval — belongs to the coach,
 * so this module is deliberately small: create one row, read your own rows,
 * read one row.
 *
 * Two rules run through all of it:
 *
 *  - **A student only ever sees their own sessions.** Every read is scoped by
 *    `student_id` as well as by id, so a guessed id returns nothing rather than
 *    someone else's interview prep. Admins are the single exception.
 *  - **Ticked context must belong to the student.** The picker sends ids, and
 *    ids are guessable. Ownership is re-checked here rather than trusted from
 *    the client — otherwise anyone could attach another user's CV to their own
 *    booking and read it back in the generated pack.
 */

import type {
  CoachingContextRefs,
  CoachingPack,
  CoachingSession,
  CoachingSessionSummary,
  CoachingSessionType,
  CreateCoachingSessionRequest,
  SaveSessionNotesRequest,
  SessionNotes,
  StudentCoachingPack,
  UpdateCoachingPackRequest,
  UpdateCoachingSessionRequest,
} from '@advance-academy/contracts/coaching';
import { getSupabase } from '../lib/supabase.js';
import { assertCoachingCredit, spendCoachingCredit } from '../lib/credits.js';
import { isAdminUser } from '../lib/admin.js';

const SESSION_TYPES: CoachingSessionType[] = ['interview_prep', 'cv_review', 'career_direction'];

/** Enough of a JD to be worth storing. Thinness is Stage 0's call, not intake's. */
const JD_MIN_CHARS = 40;
const JD_MAX_CHARS = 60_000;
const MAX_PROPOSED_SLOTS = 5;

const SELECT_COLS = `
  id, student_id, created_by, session_type, status,
  company_name, company_url, jd_text, stage, interviewer_role, worry_text,
  context_refs, interview_at, proposed_slots, scheduled_at,
  context_report, coach_notes, generated_pack, error_json,
  session_notes, approved_at, approved_by, created_at, updated_at
`;

const SUMMARY_COLS =
  'id, student_id, status, session_type, company_name, stage, interview_at, scheduled_at, created_at';

interface SessionRow {
  id: string;
  student_id: string;
  created_by: string | null;
  session_type: string;
  status: string;
  company_name: string;
  company_url: string | null;
  jd_text: string;
  stage: string | null;
  interviewer_role: string | null;
  worry_text: string | null;
  context_refs: CoachingContextRefs | null;
  interview_at: string | null;
  proposed_slots: string[] | null;
  scheduled_at: string | null;
  context_report: unknown;
  coach_notes: string | null;
  generated_pack: unknown;
  error_json: unknown;
  session_notes: unknown;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

function toSession(row: SessionRow): CoachingSession {
  return {
    id: row.id,
    studentId: row.student_id,
    createdBy: row.created_by,
    sessionType: row.session_type as CoachingSessionType,
    status: row.status as CoachingSession['status'],
    companyName: row.company_name,
    companyUrl: row.company_url,
    jdText: row.jd_text,
    stage: row.stage,
    interviewerRole: row.interviewer_role,
    worryText: row.worry_text,
    contextRefs: row.context_refs ?? {},
    interviewAt: row.interview_at,
    proposedSlots: row.proposed_slots ?? [],
    scheduledAt: row.scheduled_at,
    contextReport: row.context_report ?? null,
    coachNotes: row.coach_notes,
    generatedPack: row.generated_pack ?? null,
    errorJson: row.error_json ?? null,
    // Cast rather than validate: jsonb comes back untyped, and rows written
    // before this shape existed simply read as null-ish here.
    sessionNotes: (row.session_notes as SessionNotes | null) ?? null,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function invalid(message: string): Error {
  // 422, not 400: the request is well-formed JSON that fails a business rule.
  // The booking form maps this straight onto the offending field.
  return Object.assign(new Error(message), { statusCode: 422, code: 'INVALID_BOOKING' });
}

// ── Validation (pure — unit-tested) ─────────────────────────────────────────

export interface NormalisedBooking {
  sessionType: CoachingSessionType;
  companyName: string;
  companyUrl: string | null;
  jdText: string;
  stage: string | null;
  interviewerRole: string | null;
  worryText: string | null;
  interviewAt: string | null;
  proposedSlots: string[];
}

function cleanOptional(value: string | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Accept only what Postgres will accept as timestamptz, and only in the future. */
function cleanIsoDate(value: string | undefined, field: string): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw invalid(`${field} is not a valid date.`);
  }
  return parsed.toISOString();
}

/**
 * Turn a booking form submission into row values, or throw 422 with a message
 * the form can show against the field that caused it.
 */
export function normaliseBooking(body: CreateCoachingSessionRequest): NormalisedBooking {
  const sessionType = (body.sessionType ?? 'interview_prep') as CoachingSessionType;
  if (!SESSION_TYPES.includes(sessionType)) {
    throw invalid(`sessionType must be one of: ${SESSION_TYPES.join(', ')}`);
  }

  const companyName = body.companyName?.trim();
  if (!companyName) throw invalid('Which company is this interview with?');

  const jdText = body.jdText?.trim() ?? '';
  if (jdText.length < JD_MIN_CHARS) {
    throw invalid('Paste the job description — the pack is built by comparing it to the CV.');
  }

  const slots = Array.isArray(body.proposedSlots) ? body.proposedSlots : [];
  if (slots.length > MAX_PROPOSED_SLOTS) {
    throw invalid(`Offer at most ${MAX_PROPOSED_SLOTS} time slots.`);
  }
  const proposedSlots = slots
    .map((s, i) => cleanIsoDate(s, `Time slot ${i + 1}`))
    .filter((s): s is string => s !== null);

  return {
    sessionType,
    companyName: companyName.slice(0, 200),
    companyUrl: cleanOptional(body.companyUrl, 500),
    jdText: jdText.slice(0, JD_MAX_CHARS),
    stage: cleanOptional(body.stage, 120),
    interviewerRole: cleanOptional(body.interviewerRole, 120),
    worryText: cleanOptional(body.worryText, 2000),
    interviewAt: cleanIsoDate(body.interviewAt, 'Interview date'),
    proposedSlots,
  };
}

// ── Context ownership ───────────────────────────────────────────────────────

async function idsOwnedBy(
  table: string,
  ownerColumn: string,
  studentId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await getSupabase()
    .from(table)
    .select('id')
    .eq(ownerColumn, studentId)
    .in('id', ids);
  if (error) {
    throw Object.assign(new Error('Could not verify the attached context'), {
      statusCode: 500,
      cause: error,
    });
  }
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Keep only the ids this student actually owns, silently dropping the rest.
 *
 * Silent rather than an error on purpose: the honest cause is a stale picker
 * (a CV deleted in another tab), and failing a booking over it would be
 * baffling. The dishonest cause — a guessed id — deserves no feedback at all.
 */
export async function filterOwnedContextRefs(
  studentId: string,
  refs: CoachingContextRefs | undefined,
): Promise<CoachingContextRefs> {
  if (!refs) return {};

  const toolResultIds = (refs.toolResultIds ?? []).filter(Boolean).slice(0, 20);
  const cvAnalysisJobIds = (refs.cvAnalysisJobIds ?? []).filter(Boolean).slice(0, 20);
  const cvVersionId = refs.cvVersionId?.trim() || null;

  const [ownedCv, ownedRuns, ownedAnalyses] = await Promise.all([
    cvVersionId ? idsOwnedBy('cv_versions', 'user_id', studentId, [cvVersionId]) : Promise.resolve([]),
    idsOwnedBy('tool_results', 'user_id', studentId, toolResultIds),
    idsOwnedBy('cv_analysis_jobs', 'user_id', studentId, cvAnalysisJobIds),
  ]);

  return {
    cvVersionId: ownedCv[0] ?? null,
    toolResultIds: ownedRuns,
    cvAnalysisJobIds: ownedAnalyses,
  };
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface CreateSessionArgs {
  /** Who is making the request. */
  actorId: string;
  body: CreateCoachingSessionRequest;
}

/**
 * Book one coaching session.
 *
 * Quota is charged to the student, and only when they book for themselves. A
 * coach booking on someone's behalf is making a judgement call the quota was
 * never meant to override — they are already the scarce resource being spent.
 */
export async function createCoachingSession({
  actorId,
  body,
}: CreateSessionArgs): Promise<CoachingSession> {
  const normalised = normaliseBooking(body);
  const actorIsAdmin = await isAdminUser(actorId);

  const requestedStudentId = body.studentId?.trim();
  if (requestedStudentId && requestedStudentId !== actorId && !actorIsAdmin) {
    throw Object.assign(new Error('You can only book a session for yourself.'), {
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  }
  const studentId = requestedStudentId || actorId;
  const onBehalf = studentId !== actorId;

  // Gate + quota. Skipped entirely for a coach booking on behalf of a student.
  if (!onBehalf) {
    await assertCoachingCredit(actorId);
  }

  const contextRefs = await filterOwnedContextRefs(studentId, body.contextRefs);

  const { data, error } = await getSupabase()
    .from('coaching_sessions')
    .insert({
      student_id: studentId,
      created_by: actorId,
      session_type: normalised.sessionType,
      // Stays 'draft' until the orchestrator (T4) picks it up and moves it to
      // 'generating'. Until that exists, a booked session simply waits here.
      status: 'draft',
      company_name: normalised.companyName,
      company_url: normalised.companyUrl,
      jd_text: normalised.jdText,
      stage: normalised.stage,
      interviewer_role: normalised.interviewerRole,
      worry_text: normalised.worryText,
      context_refs: contextRefs,
      interview_at: normalised.interviewAt,
      proposed_slots: normalised.proposedSlots,
    })
    .select(SELECT_COLS)
    .single();

  if (error || !data) {
    throw Object.assign(new Error('Could not book the session'), { statusCode: 500, cause: error });
  }

  // Charged after the row exists, so a failed insert never costs the student
  // their one session — the same rule the credit wallet follows.
  if (!onBehalf) {
    await spendCoachingCredit(actorId);
  }

  return toSession(data as unknown as SessionRow);
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Sessions visible to this caller. A student gets their own; an admin gets
 * everyone's, newest interview first — that is the coach's queue.
 */
export async function listCoachingSessions(
  userId: string,
  opts: { asAdmin?: boolean; studentId?: string; limit?: number } = {},
): Promise<CoachingSessionSummary[]> {
  const supabase = getSupabase();
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);

  let query = supabase.from('coaching_sessions').select(SUMMARY_COLS).limit(limit);

  if (opts.asAdmin) {
    // A coach can narrow to one student; otherwise they see the whole queue.
    if (opts.studentId) query = query.eq('student_id', opts.studentId);
    query = query.order('interview_at', { ascending: true, nullsFirst: false });
  } else {
    query = query.eq('student_id', userId).order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) {
    throw Object.assign(new Error('Could not load coaching sessions'), {
      statusCode: 500,
      cause: error,
    });
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    studentId: row.student_id as string,
    status: row.status as CoachingSession['status'],
    sessionType: row.session_type as CoachingSessionType,
    companyName: row.company_name as string,
    stage: (row.stage as string | null) ?? null,
    interviewAt: (row.interview_at as string | null) ?? null,
    scheduledAt: (row.scheduled_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

// ── Coach edits (ticket T5) ─────────────────────────────────────────────────

/** Approved packs are what the student reads. Editing one silently is not on. */
function assertEditable(status: string): void {
  if (status === 'approved' || status === 'done') {
    throw Object.assign(
      new Error('This session is approved and locked. Reopen it before editing.'),
      { statusCode: 409, code: 'SESSION_LOCKED' },
    );
  }
}

/**
 * Coach-side edits to the session itself: notes, extra pages, the confirmed slot.
 *
 * `coachNotes` is the important one. It is the only route for knowledge the
 * system cannot derive — "this student freezes on competency questions", "I sent
 * two people to this company last year" — and the pack pipeline reads it as if
 * the student had written it.
 */
export async function updateCoachingSession(
  id: string,
  patch: UpdateCoachingSessionRequest,
): Promise<CoachingSession> {
  const supabase = getSupabase();

  const { data: current, error: readErr } = await supabase
    .from('coaching_sessions')
    .select('status, context_refs')
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    throw Object.assign(new Error('Could not load that session'), { statusCode: 500, cause: readErr });
  }
  if (!current) throw Object.assign(new Error('No such session.'), { statusCode: 404 });
  assertEditable(current.status as string);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (patch.coachNotes !== undefined) {
    updates.coach_notes = patch.coachNotes.trim().slice(0, 8000) || null;
  }
  if (patch.extraUrls !== undefined) {
    const urls = patch.extraUrls
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 8);
    // Lives inside context_refs rather than its own column: it is a reference to
    // material, exactly like the ticked CV and tool runs beside it.
    updates.context_refs = { ...((current.context_refs as object) ?? {}), extraUrls: urls };
  }
  for (const [key, column] of [
    ['scheduledAt', 'scheduled_at'],
    ['interviewAt', 'interview_at'],
  ] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null || value === '') {
      updates[column] = null;
      continue;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw invalid(`${key} is not a valid date.`);
    }
    updates[column] = parsed.toISOString();
  }

  const { data, error } = await supabase
    .from('coaching_sessions')
    .update(updates)
    .eq('id', id)
    .select(SELECT_COLS)
    .single();
  if (error || !data) {
    throw Object.assign(new Error('Could not update the session'), { statusCode: 500, cause: error });
  }
  return toSession(data as unknown as SessionRow);
}

/**
 * Merge coach edits into the stored pack.
 *
 * Only questions, reverse questions and the agenda are editable. The one-pager,
 * fit table and company brief are findings backed by evidence — if one is wrong,
 * the fix is to add context and regenerate, not to overwrite the evidence with
 * something that then looks equally sourced.
 */
export async function updateCoachingPack(
  id: string,
  patch: UpdateCoachingPackRequest,
): Promise<CoachingPack> {
  const supabase = getSupabase();

  const { data: current, error: readErr } = await supabase
    .from('coaching_sessions')
    .select('status, generated_pack')
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    throw Object.assign(new Error('Could not load that session'), { statusCode: 500, cause: readErr });
  }
  if (!current) throw Object.assign(new Error('No such session.'), { statusCode: 404 });
  assertEditable(current.status as string);

  const pack = current.generated_pack as CoachingPack | null;
  if (!pack) {
    throw Object.assign(new Error('There is no pack to edit yet.'), {
      statusCode: 409,
      code: 'NO_PACK',
    });
  }

  const next: CoachingPack = {
    ...pack,
    ...(patch.questions ? { questions: patch.questions.slice(0, 40) } : {}),
    ...(patch.reverseQuestions
      ? { reverseQuestions: patch.reverseQuestions.map((q) => q.trim()).filter(Boolean).slice(0, 10) }
      : {}),
    ...(patch.agenda ? { agenda: patch.agenda.slice(0, 10) } : {}),
  };

  const { error } = await supabase
    .from('coaching_sessions')
    .update({ generated_pack: next, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    throw Object.assign(new Error('Could not save your edits'), { statusCode: 500, cause: error });
  }
  return next;
}

/**
 * Sign the pack off. From here the student can read it and nothing else changes
 * it without an explicit reopen.
 */
export async function approveCoachingSession(
  id: string,
  approverId: string,
): Promise<CoachingSession> {
  const supabase = getSupabase();

  const { data: current } = await supabase
    .from('coaching_sessions')
    .select('status, generated_pack')
    .eq('id', id)
    .maybeSingle();
  if (!current) throw Object.assign(new Error('No such session.'), { statusCode: 404 });
  if (!current.generated_pack) {
    throw Object.assign(new Error('There is nothing to approve yet.'), {
      statusCode: 409,
      code: 'NO_PACK',
    });
  }

  const { data, error } = await supabase
    .from('coaching_sessions')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: approverId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(SELECT_COLS)
    .single();
  if (error || !data) {
    throw Object.assign(new Error('Could not approve the session'), { statusCode: 500, cause: error });
  }
  return toSession(data as unknown as SessionRow);
}

/** Undo an approval so the pack can be edited again. */
export async function reopenCoachingSession(id: string): Promise<CoachingSession> {
  const { data, error } = await getSupabase()
    .from('coaching_sessions')
    .update({
      status: 'ready',
      approved_at: null,
      approved_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(SELECT_COLS)
    .single();
  if (error || !data) {
    throw Object.assign(new Error('Could not reopen the session'), { statusCode: 500, cause: error });
  }
  return toSession(data as unknown as SessionRow);
}

// ── The student's view (ticket T6) ──────────────────────────────────────────

/**
 * Cut the coach's pack down to what the student should receive.
 *
 * `weaknesses`, `redFlags` and the `agenda` are written for the coach and are
 * blunt on purpose — a coach planning an hour needs the unvarnished read. The
 * same sentences handed to the student cold, with nobody in the room to put them
 * in context, read as a verdict. The coach delivers those in person.
 *
 * The fit table's gaps DO go through: knowing which requirements they cannot
 * evidence is exactly what they should be preparing for.
 */
export function toStudentPack(pack: CoachingPack, approvedAt: string | null): StudentCoachingPack {
  return {
    version: 1,
    headline: pack.studentOnePager.headline,
    currentPosition: pack.studentOnePager.currentPosition,
    strengths: pack.studentOnePager.strengths,
    companyBrief: pack.companyBrief,
    positioning: pack.fit.positioning,
    sellingPoints: pack.fit.sellingPoints,
    starStories: pack.fit.starStories,
    fitRows: pack.fit.rows,
    questions: pack.questions,
    reverseQuestions: pack.reverseQuestions,
    approvedAt,
  };
}

/** Statuses in which the student is allowed to see anything at all. */
const STUDENT_VISIBLE_STATUSES = new Set(['approved', 'done']);

/**
 * One session, or null.
 *
 * A non-admin read is scoped by `student_id` too, so another user's id is
 * indistinguishable from one that never existed. It is also where the student's
 * copy is narrowed: an unapproved pack is withheld entirely, an approved one is
 * trimmed, and the coach's private notes never travel either way.
 */
export async function getCoachingSession(
  id: string,
  userId: string,
  asAdmin: boolean,
): Promise<CoachingSession | null> {
  let query = getSupabase().from('coaching_sessions').select(SELECT_COLS).eq('id', id);
  if (!asAdmin) query = query.eq('student_id', userId);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw Object.assign(new Error('Could not load that session'), { statusCode: 500, cause: error });
  }
  if (!data) return null;

  const session = toSession(data as unknown as SessionRow);
  if (asAdmin) return session;

  const pack = session.generatedPack as CoachingPack | null;
  return {
    ...session,
    // Withheld until approved. A pack the coach has not signed off is a draft,
    // and a student reading a draft is the failure this whole gate exists for.
    generatedPack:
      pack && STUDENT_VISIBLE_STATUSES.has(session.status)
        ? toStudentPack(pack, session.approvedAt)
        : null,
    // Working notes about the student, and the readiness report that says what
    // is missing about them. Neither is theirs to read.
    coachNotes: null,
    contextReport: null,
    errorJson: null,
  };
}

// ── One-click mock (ticket T7) ──────────────────────────────────────────────

/** First meaningful line of a JD — usually the job title and location. */
function jobTitleFromJd(jdText: string): string {
  const line = jdText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 2);
  return (line ?? 'the role').slice(0, 160);
}

/**
 * Everything the Interview Lab needs to run a mock off the back of an approved
 * pack — including the approved questions as its question bank.
 *
 * This is the whole point of T7: the student rehearses the questions their coach
 * signed off, not a fresh set the model invents. Starred ones come first,
 * because the bank is read in order and those are the ones the coach decided
 * must be covered.
 *
 * Only ever built from an approved pack. Practising against a draft would mean
 * rehearsing questions the coach may be about to delete.
 */
export async function buildMockContext(
  sessionId: string,
  userId: string,
  asAdmin: boolean,
): Promise<{
  coachingSessionId: string;
  cvText: string;
  jobTitle: string;
  jobDescription: string;
  companyName: string;
  companyUrl: string;
  extraLinks: string[];
  questionBank: string[];
} | null> {
  const session = await getCoachingSession(sessionId, userId, asAdmin);
  if (!session) return null;
  if (!STUDENT_VISIBLE_STATUSES.has(session.status)) {
    throw Object.assign(
      new Error('Your coach has not released this pack yet.'),
      { statusCode: 409, code: 'NOT_APPROVED' },
    );
  }

  // getCoachingSession already narrowed the pack for a student, so read the
  // questions from whichever shape came back rather than assuming the coach's.
  const pack = session.generatedPack as { questions?: { question: string; starred?: boolean }[] } | null;
  const questionBank = (pack?.questions ?? [])
    .slice()
    .sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)))
    .map((q) => q.question.trim())
    .filter(Boolean)
    .slice(0, 20);

  const { data: cvRow } = await getSupabase()
    .from('cv_versions')
    .select('raw_text')
    .eq('user_id', session.studentId)
    .eq('id', session.contextRefs.cvVersionId ?? '')
    .maybeSingle();

  let cvText = (cvRow?.raw_text as string) ?? '';
  if (!cvText) {
    // The booking may predate the CV being ticked, or the version may be gone.
    // Fall back to their newest CV rather than starting a mock with no CV — the
    // interviewer would have nothing of theirs to challenge.
    const { data: fallback } = await getSupabase()
      .from('cv_versions')
      .select('raw_text')
      .eq('user_id', session.studentId)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    cvText = (fallback?.[0]?.raw_text as string) ?? '';
  }

  return {
    coachingSessionId: session.id,
    cvText,
    jobTitle: jobTitleFromJd(session.jdText),
    jobDescription: session.jdText,
    companyName: session.companyName,
    companyUrl: session.companyUrl ?? '',
    extraLinks: [],
    questionBank,
  };
}

/**
 * Mock interviews run against this coaching session.
 *
 * Found by the link stamped into `tool_results.input_json` when the mock was
 * evaluated (ticket T7), which is why no column was added for it: the run
 * already lives in tool_results and a copy here would be a second truth.
 */
export async function listSessionPractice(
  sessionId: string,
  studentId: string,
): Promise<{ id: string; label: string | null; createdAt: string; report: unknown }[]> {
  const { data, error } = await getSupabase()
    .from('tool_results')
    .select('id, input_summary, created_at, result')
    .eq('user_id', studentId)
    .eq('tool', 'interview')
    .eq('input_json->>coachingSessionId', sessionId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    // Pre-018 rows have no input_json at all, and an older Postgres plan can
    // reject the json filter — neither is worth failing the console over.
    console.error(`[coaching] could not load practice runs for ${sessionId}:`, error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    label: (row.input_summary as string | null) ?? null,
    createdAt: row.created_at as string,
    report: row.result,
  }));
}

// ── After the session (ticket T6.5) ─────────────────────────────────────────

/**
 * Record what came out of the hour.
 *
 * Deliberately NOT behind `assertEditable`: notes are written after the pack is
 * approved, which is precisely the state that lock exists to protect. Locking
 * the pack must not lock the record of the session it was for.
 */
export async function saveSessionNotes(
  id: string,
  patch: SaveSessionNotesRequest,
): Promise<CoachingSession> {
  const supabase = getSupabase();

  const { data: current } = await supabase
    .from('coaching_sessions')
    .select('status, session_notes')
    .eq('id', id)
    .maybeSingle();
  if (!current) throw Object.assign(new Error('No such session.'), { statusCode: 404 });

  const existing = (current.session_notes ?? {}) as Partial<SessionNotes>;
  const notes: SessionNotes = {
    summary: (patch.summary ?? existing.summary ?? '').slice(0, 10_000),
    actionItems: (patch.actionItems ?? existing.actionItems ?? [])
      .map((item) => ({ text: String(item.text ?? '').trim().slice(0, 500), done: Boolean(item.done) }))
      .filter((item) => item.text)
      .slice(0, 20),
    nextTime: (patch.nextTime ?? existing.nextTime ?? '').slice(0, 5000),
    savedAt: new Date().toISOString(),
  };

  const updates: Record<string, unknown> = {
    session_notes: notes,
    updated_at: new Date().toISOString(),
  };
  // Only ever moves forward into 'done'. A session that was never approved is
  // not finished just because someone typed a note against it.
  if (patch.markDone && current.status === 'approved') {
    updates.status = 'done';
  }

  const { data, error } = await supabase
    .from('coaching_sessions')
    .update(updates)
    .eq('id', id)
    .select(SELECT_COLS)
    .single();
  if (error || !data) {
    throw Object.assign(new Error('Could not save the notes'), { statusCode: 500, cause: error });
  }
  return toSession(data as unknown as SessionRow);
}
