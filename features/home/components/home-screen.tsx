'use client'

import { ChevronRight, Briefcase, Target, FileText, Brain } from 'lucide-react'
import { OrnamentalDivider } from '@/components/ornamental-divider'
import type { ViewName } from '@/shared/types/navigation'

interface HomeScreenProps {
  onNavigate: (view: ViewName) => void
}

export function HomeScreen({ onNavigate }: HomeScreenProps) {
  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <div className="text-center mb-16">
          <h1 className="text-5xl md:text-6xl font-serif font-bold text-blue-900 mb-6 text-balance">
            Accelerate Your Career
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto text-balance">
            Powered by AI-driven tools designed to help you land your dream job. From discovering perfect companies to mastering interviews.
          </p>
        </div>

        <OrnamentalDivider />

        <div className="grid md:grid-cols-2 gap-8 mb-16">
          <div className="bg-gray-50 rounded-xl p-8 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => onNavigate('companies')}>
            <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center mb-4">
              <Briefcase className="w-6 h-6 text-blue-900" />
            </div>
            <h3 className="text-2xl font-serif font-semibold text-blue-900 mb-3">Dream Company Finder</h3>
            <p className="text-gray-600 mb-4">Discover companies that match your career goals, industry preferences, and location requirements.</p>
            <div className="flex items-center gap-2 text-yellow-600 font-medium">
              Explore <ChevronRight className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-8 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => onNavigate('outreach')}>
            <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center mb-4">
              <Target className="w-6 h-6 text-blue-900" />
            </div>
            <h3 className="text-2xl font-serif font-semibold text-blue-900 mb-3">Recruitment Outreach</h3>
            <p className="text-gray-600 mb-4">Generate personalized outreach scripts for LinkedIn, email, and phone conversations with recruiters.</p>
            <div className="flex items-center gap-2 text-yellow-600 font-medium">
              Generate <ChevronRight className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-8 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => onNavigate('cv')}>
            <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center mb-4">
              <FileText className="w-6 h-6 text-blue-900" />
            </div>
            <h3 className="text-2xl font-serif font-semibold text-blue-900 mb-3">CV Optimizer</h3>
            <p className="text-gray-600 mb-4">Get AI-powered analysis of your CV with expert feedback on structure, content, and impact.</p>
            <div className="flex items-center gap-2 text-yellow-600 font-medium">
              Optimize <ChevronRight className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-8 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => onNavigate('interview')}>
            <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center mb-4">
              <Brain className="w-6 h-6 text-blue-900" />
            </div>
            <h3 className="text-2xl font-serif font-semibold text-blue-900 mb-3">Interview Prep</h3>
            <p className="text-gray-600 mb-4">Master behavioral questions, technical interviews, and company-specific preparation strategies.</p>
            <div className="flex items-center gap-2 text-yellow-600 font-medium">
              Prepare <ChevronRight className="w-4 h-4" />
            </div>
          </div>
        </div>

        <OrnamentalDivider />

        <div className="bg-gradient-to-r from-blue-900 to-blue-800 rounded-xl p-12 text-center text-white">
          <h2 className="text-3xl font-serif font-bold mb-4">Ready to advance your career?</h2>
          <p className="text-lg opacity-90 mb-6">Start with finding your dream company or optimizing your CV.</p>
          <div className="flex gap-4 justify-center flex-wrap">
            <button
              onClick={() => onNavigate('companies')}
              className="px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors"
            >
              Find Dream Companies
            </button>
            <button
              onClick={() => onNavigate('cv')}
              className="px-6 py-3 bg-white/20 hover:bg-white/30 rounded-lg font-semibold transition-colors"
            >
              Optimize Your CV
            </button>
          </div>
        </div>
      </div>

      <footer className="bg-blue-900 text-white mt-16 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm opacity-75">&copy; 2024 Advance Academy. Your path to career success.</p>
        </div>
      </footer>
    </>
  )
}
