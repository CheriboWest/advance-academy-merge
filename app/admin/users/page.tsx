import { UsersTable } from '@/features/admin/components/users-table'

// Admin user management (sprint F4).
// Auth is enforced twice: middleware.ts redirects anonymous visitors to /login,
// and the backend restricts the data to admins (users.is_admin or the
// ADMIN_USER_IDS allowlist) — a logged-in non-admin sees the "no admin access"
// message rendered by UsersTable.
export default function AdminUsersPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Move accounts between trial and membership, top up credits, and grant admin
          access. Upgrading to membership tops the wallet up to the membership grant;
          admins bypass credits entirely. Every change is recorded in the audit log.
        </p>
      </header>
      <UsersTable />
    </main>
  )
}
