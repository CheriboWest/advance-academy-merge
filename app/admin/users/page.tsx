import { UsersTable } from '@/features/admin/components/users-table'

// Admin user management (sprint F4). The /admin shell lives in ../layout.tsx.
export default function AdminUsersPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          People with an account. New signups land as <strong>pending</strong> and cannot
          reach any tool until approved here. You can also move them between trial and
          membership, top up credits, and grant coaching sessions. Upgrading tops the wallet
          up to the membership grant — and hands out the coaching session that comes with
          it; admins bypass both entirely. Every change is recorded in the audit log.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Admin rights are deliberately not granted from this screen — set{' '}
          <code>users.is_admin</code> in the Supabase SQL editor, or add the user id to{' '}
          <code>ADMIN_USER_IDS</code>.
        </p>
      </header>
      <UsersTable />
    </>
  )
}
