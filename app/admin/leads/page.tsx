import { LeadsTable } from '@/features/admin/components/leads-table'

// Candidate Acquisition — admin lead list (CA-001, Bước 6).
// Auth is enforced two ways: middleware.ts redirects anonymous visitors to /login,
// and the backend restricts the data itself to ADMIN_USER_IDS (a logged-in
// non-admin sees the "no admin access" message rendered by LeadsTable).
export default function AdminLeadsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Candidate Leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Leads captured across all lead magnets (quiz, and future ones). Filter by source
          or status, and export to CSV for marketing.
        </p>
      </header>
      <LeadsTable />
    </main>
  )
}
