'use client'

import { Suspense, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Navigation } from '@/components/navigation'
import { CoverLetterScreen } from '@/features/cover-letter/components/cover-letter-screen'
import { useAuth } from '@/features/auth/context/AuthContext'
import type { ViewName } from '@/shared/types/navigation'

/**
 * /cover-letter — its own route so a Career Hub job row and a tracker card can
 * deep-link into it with the job pre-filled.
 */
export default function CoverLetterPage() {
  const router = useRouter()
  const { session, loading } = useAuth()

  useEffect(() => {
    if (!loading && !session) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)
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
      <Navigation currentView="cover-letter" onNavigate={handleNavigate} />
      {/* useSearchParams needs a Suspense boundary under the App Router. */}
      <Suspense fallback={null}>
        <CoverLetterScreen />
      </Suspense>
    </div>
  )
}
