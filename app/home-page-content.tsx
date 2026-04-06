'use client'

import { useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ViewName } from '@/shared/types/navigation'
import { Navigation } from '@/components/navigation'
import { HomeScreen } from '@/features/home/components/home-screen'
import { OutreachScreen } from '@/features/outreach/components/outreach-screen'
import { CvOptimizerScreen } from '@/features/cv-optimizer/components/cv-optimizer-screen'
import { InterviewPrepScreen } from '@/features/interview-prep/components/interview-prep-screen'
import { InterviewHistoryScreen } from '@/features/interview-prep/components/interview-history-screen'

const VIEWS_FROM_QUERY = new Set<string>(['home', 'outreach', 'cv', 'interview', 'history'])

function viewFromSearchParams(searchParams: URLSearchParams | null): ViewName {
  const raw = searchParams?.get('view')
  if (!raw || raw === 'home') return 'home'
  if (VIEWS_FROM_QUERY.has(raw)) return raw as ViewName
  return 'home'
}

export function HomePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentView = viewFromSearchParams(searchParams)

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
      <Navigation currentView={currentView} onNavigate={handleNavigate} />

      {currentView === 'home' && (
        <HomeScreen onNavigate={handleNavigate} />
      )}
      {currentView === 'outreach' && (
        <OutreachScreen />
      )}
      {currentView === 'cv' && (
        <CvOptimizerScreen />
      )}
      {currentView === 'interview' && (
        <InterviewPrepScreen onNavigate={handleNavigate} />
      )}
      {currentView === 'history' && <InterviewHistoryScreen />}
    </div>
  )
}
