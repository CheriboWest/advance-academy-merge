/**
 * Cover Letter Generator (App 1, step "Prepare Application").
 *
 * The student picks a CV from their CV Library and a job, and gets back a plain
 * text letter to copy into their own email or application form — nothing is
 * sent from here. A job is either a tracked card (`savedJobId`) or typed in; in
 * both cases a thin description plus a link means the backend fetches the JD
 * from the link first.
 */

/** POST /api/cover-letter/generate */
export interface GenerateCoverLetterRequest {
  /** `cv_versions` row from the student's CV Library. */
  cvVersionId: string
  /** A tracked job. When set, the job fields below are ignored and the letter is saved onto the card. */
  savedJobId?: string
  jobTitle?: string
  companyName?: string
  jobDescription?: string
  jobUrl?: string
}

export interface GenerateCoverLetterResponse {
  coverLetter: string
  jobTitle: string
  companyName: string | null
  /** The card the letter was saved to, when the request named one. */
  savedJobId: string | null
}
