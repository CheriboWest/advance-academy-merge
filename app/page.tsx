'use client'

import { useState, useCallback } from 'react'
import type { ViewName } from '@/lib/types'
import { Navigation } from '@/components/navigation'
import { HomeView } from '@/components/views/home-view'
import { DreamCompanyView } from '@/components/views/dream-company-view'
import { OutreachView } from '@/components/views/outreach-view'
import { CvOptimizerView } from '@/components/views/cv-optimizer-view'
import { InterviewPrepView } from '@/components/views/interview-prep-view'
import { InterviewHistoryView } from '@/components/views/interview-history-view'
import { useDreamCompany } from '@/hooks/use-dream-company'
import { useOutreach } from '@/hooks/use-outreach'
import { useCvOptimizer } from '@/hooks/use-cv-optimizer'

export default function Home() {
  const [currentView, setCurrentView] = useState<ViewName>('home')

  const dreamCompany = useDreamCompany()
  const outreach = useOutreach()
  const cvOptimizer = useCvOptimizer()

  const handleNavigate = useCallback((view: ViewName) => {
    setCurrentView(view)
    dreamCompany.reset()
    outreach.reset()
    cvOptimizer.reset()
  }, [dreamCompany.reset, outreach.reset, cvOptimizer.reset])

  return (
    <div className="min-h-screen bg-white">
      <Navigation currentView={currentView} onNavigate={handleNavigate} />

      {currentView === 'home' && (
        <HomeView onNavigate={handleNavigate} />
      )}
      {currentView === 'companies' && (
        <DreamCompanyView
          step={dreamCompany.step}
          setStep={dreamCompany.setStep}
          form={dreamCompany.form}
          updateForm={dreamCompany.updateForm}
          results={dreamCompany.results}
          loading={dreamCompany.loading}
          onSearch={dreamCompany.search}
          onReset={dreamCompany.reset}
        />
      )}
      {currentView === 'outreach' && (
        <OutreachView
          form={outreach.form}
          updateForm={outreach.updateForm}
          results={outreach.results}
          clearResults={() => outreach.setResults(null)}
          loading={outreach.loading}
          onGenerate={outreach.generate}
        />
      )}
      {currentView === 'cv' && (
        <CvOptimizerView
          tab={cvOptimizer.tab}
          setTab={cvOptimizer.setTab}
          loading={cvOptimizer.loading}
          results={cvOptimizer.results}
          clearResults={() => cvOptimizer.setResults(null)}
          onUpload={cvOptimizer.upload}
        />
      )}
      {currentView === 'interview' && (
        <InterviewPrepView onNavigate={handleNavigate} />
      )}
      {currentView === 'history' && <InterviewHistoryView />}
    </div>
  )
}
