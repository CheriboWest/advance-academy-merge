// Admin user management (sprint F4).
// Mirrors the backend `AdminUserRow` returned by GET /api/admin/users.

export type Tier = 'trial' | 'membership'

/** Approval gate (migration 018). Only 'approved' accounts get past the backend. */
export type UserStatus = 'pending' | 'approved' | 'rejected'

export interface AdminUserRow {
  id: string
  email: string | null
  full_name: string | null
  status: UserStatus
  tier: Tier
  is_admin: boolean
  credit_balance: number
  referral_count: number
  /** Null until the account spends credits on a tool for the first time. */
  first_tool_used_at: string | null
  /** Null until an admin approves or rejects the account. */
  reviewed_at: string | null
  created_at: string
}

export interface AdminUsersListResponse {
  users: AdminUserRow[]
  count: number
}

export interface AdminUsersFilters {
  search?: string
  tier?: string
  status?: string
  limit?: number
}

/** PATCH body. Every field optional — send only what changes. */
export interface AdminUserPatch {
  /** Approval decision. 'pending' is the DB default, not something an admin sets. */
  status?: Exclude<UserStatus, 'pending'>
  tier?: Tier
  /** Signed change to the wallet, e.g. +5 or -2. */
  creditDelta?: number
  isAdmin?: boolean
}

export interface AdminUserPatchResponse {
  user: AdminUserRow
}
