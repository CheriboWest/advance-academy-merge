export type UserStatus = 'pending' | 'approved' | 'rejected'

/** Returned by GET /api/me — the only endpoint exempt from the approval gate. */
export interface CurrentUser {
  userId: string
  email: string
  status: UserStatus
  isAdmin: boolean
}

/** A row in the admin review queue. */
export interface AdminUser {
  id: string
  email: string
  full_name: string | null
  status: UserStatus
  created_at: string
  reviewed_at: string | null
}

/** Error codes the approval gate returns with HTTP 403. */
export const ACCOUNT_PENDING = 'ACCOUNT_PENDING'
export const ACCOUNT_REJECTED = 'ACCOUNT_REJECTED'
