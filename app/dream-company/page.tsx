'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Navigation } from '@/components/navigation'
import { DreamCompanyScreen } from '@/features/dream-company/components/dream-company-screen'
import type { ViewName } from '@/shared/types/navigation'

export default function DreamCompanyPage() {
  const router = useRouter()

  const handleNavigate = useCallback(
    (view: ViewName) => {
      if (view === 'companies') {
        router.push('/dream-company')
        return
      }
      router.push(view === 'home' ? '/' : `/?view=${view}`)
    },
    [router],
  )

  return (
    <div className="min-h-screen bg-white">
      <Navigation currentView="companies" onNavigate={handleNavigate} />
      <DreamCompanyScreen />
    </div>
  )
}
