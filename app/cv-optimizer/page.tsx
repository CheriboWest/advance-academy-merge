'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Navigation } from '@/components/navigation'
import { CvOptimizerScreen } from '@/features/cv-optimizer/components/cv-optimizer-screen'
import type { ViewName } from '@/shared/types/navigation'

export default function CvOptimizerPage() {
  const router = useRouter()

  const handleNavigate = useCallback(
    (view: ViewName) => {
      if (view === 'cv') {
        router.push('/cv-optimizer')
        return
      }
      if (view === 'cv-library') {
        router.push('/cv-library')
        return
      }
      if (view === 'companies') {
        router.push('/?view=companies')
        return
      }
      router.push(view === 'home' ? '/' : `/?view=${view}`)
    },
    [router],
  )

  return (
    <div className="min-h-screen bg-white">
      <Navigation currentView="cv" onNavigate={handleNavigate} />
      <CvOptimizerScreen />
    </div>
  )
}
