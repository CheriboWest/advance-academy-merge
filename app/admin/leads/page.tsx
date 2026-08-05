import { LeadsTable } from '@/features/admin/components/leads-table'

// Candidate Acquisition — admin lead list (CA-001, Bước 6).
// The /admin shell lives in ../layout.tsx. Auth is enforced two ways:
// middleware.ts redirects anonymous visitors to /login, and the backend
// restricts the data itself to admins (a logged-in non-admin sees the
// "no admin access" message rendered by LeadsTable).
export default function AdminLeadsPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          People who left an email but may not have an account yet — captured across all
          lead magnets (the quiz, and future ones). Filter by source or status, and export
          to CSV for marketing.
        </p>
      </header>
      <LeadsTable />
    </>
  )
}
