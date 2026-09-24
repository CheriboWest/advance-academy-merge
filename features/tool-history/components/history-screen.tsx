'use client'

import { useState } from 'react'
import { ToolRunsPanel } from './tool-runs-panel'
import { InterviewHistoryScreen } from '@/features/interview-prep/components/interview-history-screen'

type Tab = 'runs' | 'interview'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'runs', label: 'All runs', hint: 'Every tool run, newest first' },
  { id: 'interview', label: 'Interview sessions', hint: 'Full transcripts and scores' },
]

/**
 * "My history" (sprint F5).
 *
 * Two tabs on purpose: the new `tool_results` list covers every tool uniformly,
 * while the existing interview screen shows things that list can't — transcripts,
 * per-answer IRS scores, coaching. Folding one into the other would lose detail,
 * so they sit side by side.
 */
export function HistoryScreen() {
  const [tab, setTab] = useState<Tab>('runs')

  return (
    <main>
      <div className="mx-auto w-full max-w-5xl px-4 pt-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">My history</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything your tools have produced. Reopening a result replays what was
            saved — it never spends a credit or re-runs the AI.
          </p>
        </header>

        <div className="flex gap-1 border-b">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              title={t.hint}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* InterviewHistoryScreen brings its own max-width container and padding,
          so only the runs panel gets wrapped here. */}
      {tab === 'runs' ? (
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <ToolRunsPanel />
        </div>
      ) : (
        <InterviewHistoryScreen />
      )}
    </main>
  )
}
