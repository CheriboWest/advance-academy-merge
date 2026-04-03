'use client'

import { useState } from 'react'
import { Menu, X, Target } from 'lucide-react'
import type { ViewName } from '@/lib/types'
import { NAV_ITEMS } from '@/lib/mock-data'

interface NavigationProps {
  currentView: ViewName
  onNavigate: (view: ViewName) => void
}

export function Navigation({ currentView, onNavigate }: NavigationProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleNavigate = (view: ViewName) => {
    onNavigate(view)
    setMobileMenuOpen(false)
  }

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-900 rounded-full flex items-center justify-center">
              <Target className="w-5 h-5 text-yellow-500" />
            </div>
            <span className="text-xl font-serif font-semibold text-blue-900">Advance Academy</span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.view}
                onClick={() => handleNavigate(item.view)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentView === item.view
                    ? 'bg-yellow-500 text-blue-900'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 hover:bg-gray-100 rounded-lg"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden pb-4 flex flex-col gap-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.view}
                onClick={() => handleNavigate(item.view)}
                className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentView === item.view
                    ? 'bg-yellow-500 text-blue-900'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
