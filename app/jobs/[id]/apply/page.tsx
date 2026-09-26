'use client'

import { use, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Navigation } from '@/components/navigation'
import { ApplyWizard } from '@/features/job-tracking/components/apply-wizard'
import { useAuth } from '@/features/auth/context/AuthContext'
import type { ViewName } from '@/shared/types/navigation'

/** /jobs/<id>/apply — Assisted Apply for one tracked job. */
export default function ApplyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { session, loading } = useAuth()

  useEffect(() => {
    if (!loading && !session) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`)
    }
  }, [loading, session, router])

  const handleNavigate = useCallback(
    (view: ViewName) => {
      if (view === 'cv') return router.push('/cv-optimizer')
      if (view === 'cv-library') return router.push('/cv-library')
      router.push(view === 'home' ? '/' : `/?view=${view}`)
    },
    [router],
  )

  if (loading || !session) return null

  return (
    <div className="min-h-screen bg-background">
      <Navigation currentView="jobs" onNavigate={handleNavigate} />
      <ApplyWizard jobId={id} />
    </div>
  )
}
