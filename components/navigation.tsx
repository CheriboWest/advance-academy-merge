'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Menu, X, Target, LogOut } from 'lucide-react'
import type { ViewName } from '@/shared/types/navigation'
import { NAV_ITEMS } from '@/shared/config/navigation'
import { useAuth } from '@/features/auth/context/AuthContext'

interface NavigationProps {
  currentView: ViewName
  onNavigate: (view: ViewName) => void
}

export function Navigation({ currentView, onNavigate }: NavigationProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { signOut } = useAuth()
  const router = useRouter()

  const handleNavigate = (view: ViewName) => {
    onNavigate(view)
    setMobileMenuOpen(false)
  }

  const handleSignOut = async () => {
    setMobileMenuOpen(false)
    await signOut()
    router.push('/login')
  }

  const activeClass = 'bg-yellow-500 text-blue-900'
  const inactiveClass = 'text-gray-700 hover:bg-gray-100'

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
            {NAV_ITEMS.map((item) =>
              item.href ? (
                <Link
                  key={item.view}
                  href={item.href}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentView === item.view ? activeClass : inactiveClass
                  }`}
                >
                  {item.label}
                </Link>
              ) : (
                <button
                  key={item.view}
                  onClick={() => handleNavigate(item.view)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentView === item.view ? activeClass : inactiveClass
                  }`}
                >
                  {item.label}
                </button>
              )
            )}
            <button
              onClick={handleSignOut}
              className="ml-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
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
            {NAV_ITEMS.map((item) =>
              item.href ? (
                <Link
                  key={item.view}
                  href={item.href}
                  className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition-colors block ${
                    currentView === item.view ? activeClass : inactiveClass
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ) : (
                <button
                  key={item.view}
                  onClick={() => handleNavigate(item.view)}
                  className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentView === item.view ? activeClass : inactiveClass
                  }`}
                >
                  {item.label}
                </button>
              )
            )}
            <button
              onClick={handleSignOut}
              className="w-full text-left px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
