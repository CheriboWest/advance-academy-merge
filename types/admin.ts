// Admin user management (sprint F4).
// Mirrors the backend `AdminUserRow` returned by GET /api/admin/users.

export type Tier = 'trial' | 'membership'

export interface AdminUserRow {
  id: string
  email: string | null
  full_name: string | null
  tier: Tier
  is_admin: boolean
  credit_balance: number
  referral_count: number
  /** Null until the account spends credits on a tool for the first time. */
  first_tool_used_at: string | null
  created_at: string
}

export interface AdminUsersListResponse {
  users: AdminUserRow[]
  count: number
}

export interface AdminUsersFilters {
  search?: string
  tier?: string
  limit?: number
}

/** PATCH body. Every field optional — send only what changes. */
export interface AdminUserPatch {
  tier?: Tier
  /** Signed change to the wallet, e.g. +5 or -2. */
  creditDelta?: number
  isAdmin?: boolean
}

export interface AdminUserPatchResponse {
  user: AdminUserRow
}
