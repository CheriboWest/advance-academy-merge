'use client'

import { Suspense, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Navigation } from '@/components/navigation'
import { JobTrackingScreen } from '@/features/job-tracking/components/job-tracking-screen'
import { useAuth } from '@/features/auth/context/AuthContext'
import type { ViewName } from '@/shared/types/navigation'

/**
 * /jobs — the personal job tracker (AI Job Tools 1.3). Its own route rather than
 * a `?view=` so Career Hub can deep-link into it (`/jobs?add=<url>`), and so it
 * can grow into the personal dashboard without crowding the tools page.
 */
export default function JobsPage() {
  const router = useRouter()
  const { session, loading } = useAuth()

  useEffect(() => {
    if (!loading && !session) router.replace('/login')
  }, [loading, session, router])

  const handleNavigate = useCallback(
    (view: ViewName) => {
      if (view === 'cv') return router.push('/cv-optimizer')
      if (view === 'cv-library') return router.push('/cv-library')
      if (view === 'jobs') return router.push('/jobs')
      router.push(view === 'home' ? '/' : `/?view=${view}`)
    },
    [router],
  )

  if (loading || !session) return null

  return (
    <div className="min-h-screen bg-white">
      <Navigation currentView="jobs" onNavigate={handleNavigate} />
      {/* useSearchParams needs a Suspense boundary under the App Router. */}
      <Suspense fallback={null}>
        <JobTrackingScreen />
      </Suspense>
    </div>
  )
}
