'use client'

import { useState, useCallback } from 'react'
import type { ViewName } from '@/shared/types/navigation'
import { Navigation } from '@/components/navigation'
import { HomeScreen } from '@/features/home/components/home-screen'
import { DreamCompanyScreen } from '@/features/dream-company/components/dream-company-screen'
import { OutreachScreen } from '@/features/outreach/components/outreach-screen'
import { CvOptimizerScreen } from '@/features/cv-optimizer/components/cv-optimizer-screen'
import { InterviewPrepScreen } from '@/features/interview-prep/components/interview-prep-screen'

export default function Home() {
  const [currentView, setCurrentView] = useState<ViewName>('home')

  const handleNavigate = useCallback((view: ViewName) => {
    setCurrentView(view)
  }, [])

  return (
    <div className="min-h-screen bg-white">
      <Navigation currentView={currentView} onNavigate={handleNavigate} />

      {currentView === 'home' && (
        <HomeScreen onNavigate={handleNavigate} />
      )}
      {currentView === 'companies' && (
        <DreamCompanyScreen />
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
    </div>
  )
}
