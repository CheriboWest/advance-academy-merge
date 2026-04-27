'use client'

import { useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ViewName } from '@/shared/types/navigation'
import { Navigation } from '@/components/navigation'
import { HomeScreen } from '@/features/home/components/home-screen'
import { OutreachScreen } from '@/features/outreach/components/outreach-screen'
import { CvOptimizerScreen } from '@/features/cv-optimizer/components/cv-optimizer-screen'
import { InterviewPrepScreen } from '@/features/interview-prep/components/interview-prep-screen'
import { InterviewHistoryScreen } from '@/features/interview-prep/components/interview-history-screen'
import { DreamCompanyScreen } from '@/features/dream-company/components/dream-company-screen'
import { CvLibraryScreen } from '@/features/cv-library/components/cv-library-screen'
import { useAuth } from '@/features/auth/context/AuthContext'

const VIEWS_FROM_QUERY = new Set<string>(['home', 'outreach', 'cv', 'interview', 'history', 'companies', 'cv-library'])

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
  const { session, loading } = useAuth()

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/login')
    }
  }, [loading, session, router])

  const handleNavigate = useCallback(
    (view: ViewName) => {
      router.push(view === 'home' ? '/' : `/?view=${view}`)
    },
    [router],
  )

  if (loading || !session) return null

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
      {currentView === 'cv-library' && (
        <CvLibraryScreen />
      )}
      {currentView === 'interview' && (
        <InterviewPrepScreen onNavigate={handleNavigate} />
      )}
      {currentView === 'history' && <InterviewHistoryScreen />}
      {currentView === 'companies' && (
        <DreamCompanyScreen />
      )}
    </div>
  )
}
