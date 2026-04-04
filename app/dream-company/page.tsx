'use client'

import { useCallback } from 'react'
import { Navigation } from '@/components/navigation'
import { DreamCompanyScreen } from '@/features/dream-company/components/dream-company-screen'
import type { ViewName } from '@/shared/types/navigation'

export default function DreamCompanyPage() {
  const handleNavigate = useCallback((view: ViewName) => {
    window.location.href = '/'
  }, [])

  return (
    <div className="min-h-screen bg-white">
      <Navigation currentView="companies" onNavigate={handleNavigate} />
      <DreamCompanyScreen />
    </div>
  )
}
