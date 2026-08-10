import type { Contactability } from '@advance-academy/contracts';

/**
 * Reading a lead row's two derived halves: what the quiz put in `result`, and
 * whether we may lawfully contact the person.
 *
 * Both are pure so the rules can be pinned down in tests rather than through
 * Supabase — the second one especially, because getting it wrong means either
 * emailing someone who never opted in or writing off someone who did.
 */

export interface QuizFacts {
  /** Phone number exactly as typed — this is what a coach reads out loud. */
  whatsapp: string | null;
  /** The same number reduced to digits, for a wa.me link. Null if unusable. */
  whatsappDigits: string | null;
  /** Raw archetype code, e.g. 'AO'. Left raw: the label map lives in contracts. */
  house: string | null;
  scoreBreakdown: string | null;
}

const EMPTY: QuizFacts = { whatsapp: null, whatsappDigits: null, house: null, scoreBreakdown: null };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * wa.me wants digits only, no `+`, no spaces, no punctuation.
 *
 * Shortest international numbers are 7 digits (and the quiz's own field rejects
 * anything under 7), longest is E.164's 15. Outside that range the value is not
 * a phone number — a typo or a bot — and linking to it would open a dead chat,
 * so we return null and let the UI fall back to showing the raw text.
 *
 * A number with no country code is still returned: we cannot guess one, and a
 * possibly-wrong link the admin can see beats hiding the digits entirely.
 */
export function whatsappDigits(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

/**
 * Pull the quiz payload out of the untrusted `candidate_leads.result` jsonb.
 *
 * Nothing in this repo writes that column — the quiz is a separate service on
 * its own release cycle — so every field is optional and every type is checked.
 * A shape change over there degrades a column to "—" here rather than throwing.
 */
export function readQuizResult(result: unknown): QuizFacts {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return EMPTY;
  const r = result as Record<string, unknown>;
  const whatsapp = str(r.whatsapp);
  return {
    whatsapp,
    whatsappDigits: whatsappDigits(whatsapp),
    house: str(r.house),
    scoreBreakdown: str(r.scoreBreakdown),
  };
}

export interface ContactabilityInput {
  status: string;
  consent_marketing: boolean;
  double_optin: boolean;
  has_account: boolean;
}

export interface ContactabilityVerdict {
  contactable: Contactability;
  reason: string;
}

/**
 * May we send this person marketing email, and why.
 *
 * The order matters — an unsubscribe overrides an earlier opt-in, and a missing
 * opt-in is decisive regardless of anything downstream.
 *
 * The `has_account` clause is what makes this fit the quiz funnel. A quiz lead
 * who consents is sent a magic *login* link instead of the double-opt-in confirm
 * email (routes/leads.ts), so `double_optin` never flips true for them no matter
 * how engaged they are. Signing in through that link proves inbox ownership just
 * as well as clicking a confirm link does; without this clause every quiz lead
 * would sit at 'pending' forever and the column would be worthless.
 */
export function contactability(row: ContactabilityInput): ContactabilityVerdict {
  if (row.status === 'unsub') {
    return { contactable: 'no', reason: 'Unsubscribed' };
  }
  if (!row.consent_marketing) {
    return { contactable: 'no', reason: 'Never opted in to marketing' };
  }
  if (row.double_optin) {
    return { contactable: 'yes', reason: 'Opted in and confirmed by email link' };
  }
  if (row.has_account) {
    return { contactable: 'yes', reason: 'Opted in and signed in via magic link' };
  }
  return { contactable: 'pending', reason: 'Opted in, but inbox ownership unproven' };
}
