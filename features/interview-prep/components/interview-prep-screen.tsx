'use client'

import { Brain } from 'lucide-react'
import type { ViewName } from '@/lib/types'

interface InterviewPrepScreenProps {
  onNavigate: (view: ViewName) => void
}

export function InterviewPrepScreen({ onNavigate }: InterviewPrepScreenProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-serif font-bold text-blue-900 mb-4">Interview Preparation</h1>
      <p className="text-gray-600 text-lg mb-12">Master behavioral questions, technical challenges, and company-specific insights.</p>

      <div className="bg-blue-50 rounded-xl p-12 text-center">
        <Brain className="w-16 h-16 text-yellow-500 mx-auto mb-6" />
        <h2 className="text-3xl font-serif font-bold text-blue-900 mb-4">Coming Soon</h2>
        <p className="text-gray-600 text-lg max-w-2xl mx-auto mb-8">
          Our interview preparation module is being crafted to help you ace any interview. Features include mock interviews, behavioral question training, and company research guidance.
        </p>
        <button
          onClick={() => onNavigate('home')}
          className="px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors"
        >
          Back to Home
        </button>
      </div>
    </div>
  )
}
