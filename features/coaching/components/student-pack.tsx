'use client'

import { ArrowLeft, Lock, Mic, Printer } from 'lucide-react'
import type { CoachingSession, StudentCoachingPack } from '@advance-academy/contracts/coaching'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCoachingSession, useSessionPractice } from '../hooks/use-coaching'

/**
 * What the student reads once their coach has approved the pack (ticket T6).
 *
 * The narrowing is done server-side — this component renders whatever it is
 * given. That is deliberate: a UI that simply omits a field has still shipped it
 * to the browser, where anyone can open the network tab. See `toStudentPack`.
 *
 * Export is `window.print()` plus print styles rather than a PDF library. The
 * browser already renders this well; adding a server-side renderer would be a
 * dependency and a second layout to keep in sync, for a Save-as-PDF dialog the
 * student already has.
 */

const STRENGTH_DOT = {
  strong: 'bg-green-500',
  partial: 'bg-yellow-500',
  gap: 'bg-red-500',
} as const

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function StudentPack({
  sessionId,
  onBack,
  onPractise,
}: {
  sessionId: string
  onBack: () => void
  /** Hand this session off to the Interview Lab for a mock (ticket T7). */
  onPractise: (sessionId: string) => void
}) {
  const { data, isLoading, error } = useCoachingSession(sessionId)
  const practice = useSessionPractice(sessionId)
  const session = data?.session as CoachingSession | undefined
  const pack = session?.generatedPack as StudentCoachingPack | null

  if (isLoading) return <Skeleton className="h-96 w-full" />
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        Could not load this session: {(error as Error).message}
      </div>
    )
  }
  if (!session) return null

  return (
    <div className="space-y-8">
      {/* Hidden on paper: navigation is meaningless in an exported document. */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          My sessions
        </button>
        {pack ? (
          <div className="flex gap-2">
            {/*
              One-click mock (ticket T7). Hands the Interview Lab this session's
              id; the setup step fetches the context and the coach's approved
              questions from it, so the student rehearses the questions that were
              signed off rather than a fresh set the model invents.
            */}
            <Button size="sm" onClick={() => onPractise(sessionId)}>
              <Mic className="mr-1.5 h-4 w-4" />
              Practise these questions
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" />
              Save as PDF
            </Button>
          </div>
        ) : null}
      </div>

      {practice.data && practice.data.count > 0 ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm print:hidden">
          You have practised this {practice.data.count} time
          {practice.data.count === 1 ? '' : 's'}. Your coach can see how it went.
        </div>
      ) : null}

      <header>
        <h1 className="text-2xl font-semibold">Interview prep · {session.companyName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[
            session.stage,
            session.interviewerRole,
            session.interviewAt
              ? `interview ${new Date(session.interviewAt).toLocaleDateString()}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      {!pack ? (
        <div className="rounded-md border bg-muted/40 p-8 text-center print:hidden">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Your coach is still preparing this</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You will see it here once they have reviewed and approved it.
          </p>
        </div>
      ) : (
        <>
          <Section title="How to position yourself">
            <p className="text-lg font-medium">{pack.headline}</p>
            <p className="text-sm text-muted-foreground">{pack.currentPosition}</p>
            <p className="mt-2">{pack.positioning}</p>
          </Section>

          {pack.strengths.length > 0 ? (
            <Section title="What you lead with">
              <ul className="space-y-1">
                {pack.strengths.map((s, i) => (
                  <li key={i} className="text-sm">
                    • {s}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {pack.sellingPoints.length > 0 ? (
            <Section title="Your selling points">
              <div className="space-y-2">
                {pack.sellingPoints.map((p, i) => (
                  <div key={i} className="rounded-md border p-3">
                    <p className="text-sm font-medium">{p.point}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Backed by: {p.evidence}</p>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {pack.starStories.length > 0 ? (
            <Section title="Stories you already have">
              <div className="space-y-2">
                {pack.starStories.map((s, i) => (
                  <div key={i} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{s.competency}</p>
                    <p className="mt-1">
                      <span className="text-muted-foreground">Situation:</span> {s.situation}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Task:</span> {s.task}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Action:</span> {s.action}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Result:</span> {s.result}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {pack.fitRows.length > 0 ? (
            <Section title="What they asked for, and what you can show">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {pack.fitRows.map((r, i) => (
                      <tr key={i} className="border-b align-top">
                        <td className="w-4 py-2 pr-2">
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${STRENGTH_DOT[r.strength]}`}
                          />
                        </td>
                        <td className="py-2 pr-3 font-medium">{r.requirement}</td>
                        <td className="py-2 text-muted-foreground">
                          {r.evidence ?? (
                            <span className="italic">
                              nothing on your CV yet — prepare for this one
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}

          <Section title={`Questions to expect (${pack.questions.length})`}>
            <div className="space-y-3">
              {pack.questions.map((q) => (
                <div key={q.id} className="break-inside-avoid rounded-md border p-3">
                  <p className="text-sm font-medium">
                    {q.starred ? '⭐ ' : ''}
                    {q.question}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{q.whyAsked}</p>
                  <p className="mt-2 text-sm">{q.suggestedAnswer}</p>
                </div>
              ))}
            </div>
          </Section>

          {pack.reverseQuestions.length > 0 ? (
            <Section title="Questions to ask them">
              <ul className="space-y-1.5">
                {pack.reverseQuestions.map((q, i) => (
                  <li key={i} className="text-sm">
                    • {q}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title={`About ${pack.companyBrief.companyName}`}>
            {[
              { title: 'What they do', facts: pack.companyBrief.overview },
              { title: 'Products', facts: pack.companyBrief.products },
              { title: 'Recently', facts: pack.companyBrief.recentActivity },
              { title: 'How they work', facts: pack.companyBrief.culture },
            ].map((block) =>
              block.facts.length > 0 ? (
                <div key={block.title} className="mt-2">
                  <h3 className="text-sm font-semibold">{block.title}</h3>
                  <ul className="mt-1 space-y-1">
                    {block.facts.map((f, i) => (
                      <li key={i} className="text-sm">
                        {f.claim}{' '}
                        <a
                          href={f.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-600 underline"
                        >
                          source
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </Section>

          <footer className="border-t pt-4 text-xs text-muted-foreground">
            Prepared by your coach
            {pack.approvedAt ? ` on ${new Date(pack.approvedAt).toLocaleDateString()}` : ''}. Every
            statement about the company links to where it came from — check them before you go in.
          </footer>
        </>
      )}
    </div>
  )
}
