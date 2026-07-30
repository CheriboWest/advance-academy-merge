import { AdminNav } from '@/features/admin/components/admin-nav'

// Shell for every /admin page. Anonymous visitors are already redirected to
// /login by middleware.ts; the per-page data calls are what actually enforce
// admin rights (a logged-in non-admin gets a 403 and the explanatory message).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <AdminNav />
      {children}
    </main>
  )
}
