'use client'

import { AlertTriangle, Briefcase, Loader, Newspaper, Search } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { EnrichmentCard, EnrichmentResponse, ExperienceLevel } from '@/types/outreach'
import { SignalCard, SignalCardSkeleton } from './signal-card'

const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: 'senior', label: 'Senior' },
  { value: 'mid', label: 'Mid-level' },
  { value: 'fresher', label: 'Fresher' },
  { value: 'intern', label: 'Intern' },
]

interface EnrichmentPanelProps {
  experienceLevel: ExperienceLevel
  onChangeExperienceLevel: (level: ExperienceLevel) => void
  enrichmentResults: EnrichmentResponse | null
  selectedHiringCard: EnrichmentCard | null
  selectedSocialCard: EnrichmentCard | null
  onSelectHiring: (card: EnrichmentCard) => void
  onSelectSocial: (card: EnrichmentCard) => void
  onSearch: () => void
  loading: boolean
  error: string | null
  canSearch: boolean
}

export function EnrichmentPanel({
  experienceLevel,
  onChangeExperienceLevel,
  enrichmentResults,
  selectedHiringCard,
  selectedSocialCard,
  onSelectHiring,
  onSelectSocial,
  onSearch,
  loading,
  error,
  canSearch,
}: EnrichmentPanelProps) {
  const showSkeletons = loading
  const hasResults = !loading && enrichmentResults !== null

  return (
    <div className="p-8 bg-white border border-gray-200 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="mb-6">
        <h3 className="text-xl font-serif font-bold text-blue-900 flex items-center gap-2">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-sm">3</span>
          Find Enrichment Context
        </h3>
        <p className="mt-1 ml-10 text-sm text-gray-500">
          Select relevant results to personalise your message
        </p>
      </div>

      <div className="mb-6 ml-10">
        <label className="block text-sm font-semibold text-blue-900 mb-2">
          Experience Level <span className="text-red-500">*</span>
        </label>
        <ToggleGroup
          type="single"
          value={experienceLevel}
          onValueChange={(v) => v && onChangeExperienceLevel(v as ExperienceLevel)}
          variant="outline"
          className="flex flex-wrap gap-0"
        >
          {EXPERIENCE_LEVELS.map((opt) => (
            <ToggleGroupItem
              key={opt.value}
              value={opt.value}
              aria-label={opt.label}
              className="px-5 data-[state=on]:bg-blue-600 data-[state=on]:text-white data-[state=on]:border-blue-600"
            >
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="ml-10 mb-6">
        <button
          type="button"
          onClick={onSearch}
          disabled={!canSearch || loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <Loader className="w-4 h-4 animate-spin" /> Searching with Exa…
            </>
          ) : (
            <>
              <Search className="w-4 h-4" /> Search for context
            </>
          )}
        </button>
        {!canSearch && (
          <p className="mt-2 text-xs text-gray-400">
            Fill in Target Company and Target Role to enable search.
          </p>
        )}
      </div>

      {error && (
        <div className="ml-10 mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Enrichment failed</p>
            <p className="text-xs mt-0.5">{error}</p>
            <button
              type="button"
              onClick={onSearch}
              className="mt-2 text-xs font-semibold text-red-700 underline hover:text-red-900"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {(showSkeletons || hasResults) && (
        <div className="ml-10 grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-blue-600" />
              <h4 className="text-sm font-bold text-blue-900">Current Hiring</h4>
            </div>
            <div className="space-y-3">
              {showSkeletons &&
                Array.from({ length: 3 }).map((_, i) => <SignalCardSkeleton key={i} />)}
              {hasResults && enrichmentResults!.hiringResults.length === 0 && (
                <p className="text-xs text-gray-400 italic">No hiring results found.</p>
              )}
              {hasResults &&
                enrichmentResults!.hiringResults.map((card) => (
                  <SignalCard
                    key={card.url}
                    card={card}
                    selected={selectedHiringCard?.url === card.url}
                    onSelect={() => onSelectHiring(card)}
                  />
                ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-yellow-600" />
              <h4 className="text-sm font-bold text-blue-900">Recent Activity & Posts</h4>
            </div>
            <div className="space-y-3">
              {showSkeletons &&
                Array.from({ length: 3 }).map((_, i) => <SignalCardSkeleton key={i} />)}
              {hasResults && enrichmentResults!.socialResults.length === 0 && (
                <p className="text-xs text-gray-400 italic">No social results found.</p>
              )}
              {hasResults &&
                enrichmentResults!.socialResults.map((card) => (
                  <SignalCard
                    key={card.url}
                    card={card}
                    selected={selectedSocialCard?.url === card.url}
                    onSelect={() => onSelectSocial(card)}
                  />
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
