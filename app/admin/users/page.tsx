import { UsersTable } from '@/features/admin/components/users-table'

// Admin user management (sprint F4). The /admin shell lives in ../layout.tsx.
export default function AdminUsersPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          People with an account. Move them between trial and membership, top up credits,
          and grant admin access. Upgrading tops the wallet up to the membership grant;
          admins bypass credits entirely. Every change is recorded in the audit log.
        </p>
      </header>
      <UsersTable />
    </>
  )
}
