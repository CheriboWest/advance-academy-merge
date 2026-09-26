'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Unlock,
} from 'lucide-react'
import type {
  CoachingPack,
  CoachingSession,
  PackQuestion,
  QuestionCategory,
} from '@advance-academy/contracts/coaching'
import { BackLink } from '@/components/back-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  useCoachingAction,
  useCoachingSession,
  useUpdateCoachingPack,
} from '../hooks/use-coaching'
import { ContextDesk } from './context-desk'
import { SessionNotesPanel } from './session-notes'

/**
 * The coach's battlecard (ticket T5).
 *
 * Everything generated for one session, in the order a coach reads it, with the
 * questions editable. Two rules shape what is editable and what is not:
 *
 *  - **Questions, reverse questions and the agenda are the coach's.** They know
 *    the student; the model is guessing.
 *  - **The one-pager, fit table and company brief are findings.** Each is backed
 *    by CV evidence or a cited page. Hand-editing them would produce a claim that
 *    looks equally sourced and is not, which is the exact failure the citation
 *    guard in the research service exists to prevent.
 *
 * Text edits never call an LLM. Only "rewrite this question" does, and only for
 * the one question.
 */

type Tab = 'overview' | 'fit' | 'questions' | 'agenda' | 'company' | 'notes'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Who they are' },
  { id: 'fit', label: 'Fit' },
  { id: 'questions', label: 'Questions' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'company', label: 'Company' },
  { id: 'notes', label: 'After the session' },
]

const CATEGORIES: QuestionCategory[] = [
  'behavioural',
  'technical',
  'motivation',
  'company',
  'situational',
]
const DIFFICULTIES: PackQuestion['difficulty'][] = ['easy', 'medium', 'hard']

const STRENGTH_STYLE = {
  strong: { dot: 'bg-green-500', label: 'strong' },
  partial: { dot: 'bg-secondary', label: 'partial' },
  gap: { dot: 'bg-red-500', label: 'gap' },
} as const

const selectClass =
  'h-7 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring'

// ── Question editing ────────────────────────────────────────────────────────

function QuestionCard({
  question,
  locked,
  onChange,
  onDelete,
  onRegenerate,
  regenerating,
}: {
  question: PackQuestion
  locked: boolean
  onChange: (next: PackQuestion) => void
  onDelete: () => void
  onRegenerate: (direction: string) => void
  regenerating: boolean
}) {
  const [direction, setDirection] = useState('')
  const [showDirection, setShowDirection] = useState(false)

  return (
    <div className="space-y-2 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          disabled={locked}
          onClick={() => onChange({ ...question, starred: !question.starred })}
          title={question.starred ? 'Unstar' : 'Star — must cover this one'}
        >
          <Star
            className={`h-4 w-4 ${question.starred ? 'fill-secondary text-highlight-ink' : 'text-muted-foreground'}`}
          />
        </Button>
        <select
          className={selectClass}
          value={question.category}
          disabled={locked}
          onChange={(e) => onChange({ ...question, category: e.target.value as QuestionCategory })}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={question.difficulty}
          disabled={locked}
          onChange={(e) =>
            onChange({ ...question, difficulty: e.target.value as PackQuestion['difficulty'] })
          }
        >
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={locked || regenerating}
            onClick={() => setShowDirection((v) => !v)}
            title="Rewrite this question"
          >
            {regenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-destructive"
            disabled={locked}
            onClick={onDelete}
            title="Remove this question"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Textarea
        value={question.question}
        disabled={locked}
        rows={2}
        onChange={(e) => onChange({ ...question, question: e.target.value })}
        className="font-medium"
      />

      {showDirection && !locked ? (
        <div className="flex gap-2 rounded-md bg-muted/50 p-2">
          <Input
            value={direction}
            placeholder="Make it harder / focus on the SQL gap / ask about the career break…"
            onChange={(e) => setDirection(e.target.value)}
            className="h-8"
          />
          <Button
            type="button"
            size="sm"
            disabled={regenerating}
            onClick={() => {
              onRegenerate(direction)
              setShowDirection(false)
              setDirection('')
            }}
          >
            Rewrite
          </Button>
        </div>
      ) : null}

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Why they ask it</p>
        <Textarea
          value={question.whyAsked}
          disabled={locked}
          rows={2}
          onChange={(e) => onChange({ ...question, whyAsked: e.target.value })}
          className="text-sm"
        />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">How they should answer</p>
        <Textarea
          value={question.suggestedAnswer}
          disabled={locked}
          rows={3}
          onChange={(e) => onChange({ ...question, suggestedAnswer: e.target.value })}
          className="text-sm"
        />
      </div>
    </div>
  )
}

function QuestionsTab({
  pack,
  sessionId,
  locked,
}: {
  pack: CoachingPack
  sessionId: string
  locked: boolean
}) {
  const savePack = useUpdateCoachingPack(sessionId)
  const action = useCoachingAction(sessionId)
  const [questions, setQuestions] = useState<PackQuestion[]>(pack.questions)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // Re-seed when the server copy changes (a rewrite landed, or another tab
  // saved). Guarded on `dirty` so it never wipes edits in progress.
  useEffect(() => {
    if (!dirty) setQuestions(pack.questions)
  }, [pack.questions, dirty])

  const update = (next: PackQuestion[]) => {
    setQuestions(next)
    setDirty(true)
  }

  const save = () =>
    savePack.mutate({ questions }, { onSuccess: () => setDirty(false) })

  const regenerate = (question: PackQuestion, direction: string) => {
    setRegeneratingId(question.id)
    action.mutate(
      {
        action: 'regenerate-question',
        payload: { questionId: question.id, direction: direction || undefined },
      },
      {
        // The server already wrote the replacement to the row, so the refetch
        // the mutation triggers is the source of truth — just stop blocking.
        onSettled: () => {
          setRegeneratingId(null)
          setDirty(false)
        },
      },
    )
  }

  const addManual = () =>
    update([
      ...questions,
      {
        id: `${sessionId.slice(0, 8)}-manual-${Date.now()}`,
        question: '',
        category: 'behavioural',
        difficulty: 'medium',
        whyAsked: '',
        suggestedAnswer: '',
      },
    ])

  const starred = questions.filter((q) => q.starred).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {questions.length} questions{starred > 0 ? ` · ${starred} starred` : ''}
        </p>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={addManual} disabled={locked}>
            <Plus className="mr-1 h-4 w-4" />
            Add your own
          </Button>
          <Button size="sm" onClick={save} disabled={locked || !dirty || savePack.isPending}>
            {savePack.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </div>

      {savePack.error || action.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {((savePack.error ?? action.error) as Error).message}
        </div>
      ) : null}

      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            question={q}
            locked={locked}
            regenerating={regeneratingId === q.id}
            onChange={(next) => update(questions.map((x, idx) => (idx === i ? next : x)))}
            onDelete={() => update(questions.filter((_, idx) => idx !== i))}
            onRegenerate={(direction) => regenerate(q, direction)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Read-only tabs ──────────────────────────────────────────────────────────

function OverviewTab({ pack }: { pack: CoachingPack }) {
  const p = pack.studentOnePager
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold">{p.headline || '—'}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{p.currentPosition}</p>
      </div>
      {[
        { title: 'Strengths', items: p.strengths, className: 'text-green-700' },
        { title: 'Weaknesses', items: p.weaknesses, className: 'text-red-700' },
        { title: 'What the tools found', items: p.historyNotes, className: 'text-muted-foreground' },
      ].map((block) =>
        block.items.length > 0 ? (
          <section key={block.title}>
            <h4 className="text-sm font-semibold">{block.title}</h4>
            <ul className="mt-1 space-y-1">
              {block.items.map((item, i) => (
                <li key={i} className={`text-sm ${block.className}`}>
                  • {item}
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  )
}

function FitTab({ pack }: { pack: CoachingPack }) {
  const { fit } = pack
  return (
    <div className="space-y-6">
      <section>
        <h4 className="text-sm font-semibold">How to position them</h4>
        <p className="mt-1 text-sm">{fit.positioning}</p>
      </section>

      {fit.redFlags.length > 0 ? (
        <section>
          <h4 className="text-sm font-semibold text-red-700">
            What the interviewer will notice ({fit.redFlags.length})
          </h4>
          <ul className="mt-1 space-y-1.5">
            {fit.redFlags.map((f, i) => (
              <li key={i} className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900">
                {f}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h4 className="text-sm font-semibold">Selling points</h4>
        <div className="mt-1 space-y-2">
          {fit.sellingPoints.map((p, i) => (
            <div key={i} className="rounded-md border p-3">
              <p className="text-sm font-medium">{p.point}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">From the CV: {p.evidence}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 className="text-sm font-semibold">STAR stories ready to use</h4>
        <div className="mt-1 space-y-2">
          {fit.starStories.map((s, i) => (
            <div key={i} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{s.competency}</p>
              <p className="mt-1">
                <span className="text-muted-foreground">Situation:</span> {s.situation}
              </p>
              <p>
                <span className="text-muted-foreground">Action:</span> {s.action}
              </p>
              <p>
                <span className="text-muted-foreground">Result:</span> {s.result}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">CV bullet: {s.sourceBullet}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 className="text-sm font-semibold">
          Job description against the CV ({fit.rows.length})
        </h4>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {fit.rows.map((r, i) => (
                <tr key={i} className="border-b align-top">
                  <td className="w-4 py-2 pr-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${STRENGTH_STYLE[r.strength].dot}`}
                      title={STRENGTH_STYLE[r.strength].label}
                    />
                  </td>
                  <td className="py-2 pr-3 font-medium">{r.requirement}</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {r.evidence ?? <span className="italic">no CV evidence</span>}
                  </td>
                  <td className="py-2 text-xs text-orange-700">{r.probeRisk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function AgendaTab({ pack, sessionId, locked }: { pack: CoachingPack; sessionId: string; locked: boolean }) {
  const savePack = useUpdateCoachingPack(sessionId)
  const [reverse, setReverse] = useState(pack.reverseQuestions.join('\n'))
  const total = pack.agenda.reduce((s, a) => s + a.minutes, 0)

  return (
    <div className="space-y-6">
      <section>
        <h4 className="text-sm font-semibold">Session plan · {total} minutes</h4>
        <div className="mt-2 space-y-2">
          {pack.agenda.map((a, i) => (
            <div key={i} className="flex gap-3 rounded-md border p-3">
              <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">
                {a.minutes}m
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{a.title}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{a.detail}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Questions they should ask</h4>
        <Textarea
          rows={6}
          value={reverse}
          disabled={locked}
          onChange={(e) => setReverse(e.target.value)}
          placeholder="One per line."
        />
        <Button
          size="sm"
          disabled={locked || savePack.isPending}
          onClick={() =>
            savePack.mutate({ reverseQuestions: reverse.split('\n').map((s) => s.trim()).filter(Boolean) })
          }
        >
          {savePack.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      </section>
    </div>
  )
}

function CompanyTab({ pack }: { pack: CoachingPack }) {
  const brief = pack.companyBrief
  const sections = [
    { title: 'Overview', facts: brief.overview },
    { title: 'Products', facts: brief.products },
    { title: 'Recent activity', facts: brief.recentActivity },
    { title: 'Culture', facts: brief.culture },
  ]

  return (
    <div className="space-y-5">
      {brief.sparse ? (
        <div className="rounded-md border border-secondary/40 bg-secondary/10 p-3 text-sm text-highlight-ink">
          <p className="font-medium">Thin research</p>
          <ul className="mt-1 space-y-0.5">
            {brief.sparseReasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {brief.registry ? (
        <section className="rounded-md border p-3 text-sm">
          <p className="font-medium">{brief.registry.companyName}</p>
          <p className="text-muted-foreground">
            Companies House {brief.registry.companyNumber} · {brief.registry.companyStatus} ·
            incorporated {brief.registry.dateOfCreation}
          </p>
        </section>
      ) : null}

      {sections.map((s) =>
        s.facts.length > 0 ? (
          <section key={s.title}>
            <h4 className="text-sm font-semibold">{s.title}</h4>
            <ul className="mt-1 space-y-1.5">
              {s.facts.map((f, i) => (
                <li key={i} className="text-sm">
                  {f.claim}{' '}
                  <a
                    href={f.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline"
                  >
                    source
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}

      {brief.interviewAngles.length > 0 ? (
        <section>
          <h4 className="text-sm font-semibold">
            Angles to probe{' '}
            <span className="font-normal text-muted-foreground">— inference, not findings</span>
          </h4>
          <ul className="mt-1 space-y-1">
            {brief.interviewAngles.map((a, i) => (
              <li key={i} className="text-sm">
                • {a}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {brief.missingInfo.length > 0 ? (
        <section>
          <h4 className="text-sm font-semibold">Still worth finding</h4>
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
            {brief.missingInfo.map((m, i) => (
              <li key={i}>• {m}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

// ── Shell ───────────────────────────────────────────────────────────────────

function StatusLine({ session }: { session: CoachingSession }) {
  const bits = [
    session.stage,
    session.interviewerRole,
    session.interviewAt ? `interview ${new Date(session.interviewAt).toLocaleDateString()}` : null,
  ].filter(Boolean)
  return <p className="text-sm text-muted-foreground">{bits.join(' · ') || 'No interview details given'}</p>
}

export function CoachConsole({ sessionId }: { sessionId: string }) {
  const { data, isLoading, error } = useCoachingSession(sessionId)
  const action = useCoachingAction(sessionId)
  const [tab, setTab] = useState<Tab>('overview')

  const session = data?.session
  const pack = session?.generatedPack as CoachingPack | null
  const locked = session?.status === 'approved' || session?.status === 'done'

  const worry = useMemo(
    () => [session?.worryText, session?.coachNotes].filter(Boolean).join('\n\n'),
    [session?.worryText, session?.coachNotes],
  )

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
    <div className="space-y-6">
      <header className="space-y-2">
        <BackLink href="/admin/coaching">All sessions</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{session.companyName}</h1>
          <Badge variant={locked ? 'default' : 'secondary'}>{session.status}</Badge>
        </div>
        <StatusLine session={session} />
        {worry ? (
          <div className="rounded-md border-l-4 border-primary bg-primary/5 p-3 text-sm">
            <p className="font-medium text-primary">What worries them</p>
            <p className="mt-0.5 whitespace-pre-line text-primary/80">{worry}</p>
          </div>
        ) : null}
      </header>

      {session.status === 'generating' ? (
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-6">
          <Loader2 className="h-5 w-5 animate-spin" />
          <div>
            <p className="text-sm font-medium">Building the pack…</p>
            <p className="text-sm text-muted-foreground">
              Four model calls, a few minutes. This page updates itself.
            </p>
          </div>
        </div>
      ) : null}

      {session.status === 'failed' ? (
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <div>
            <p className="text-sm font-medium text-destructive">Generation failed</p>
            <p className="mt-0.5 text-sm text-destructive/80">
              {(session.errorJson as { message?: string })?.message ?? 'Unknown error.'}{' '}
              <span className="text-xs">
                (step: {(session.errorJson as { step?: string })?.step ?? 'unknown'})
              </span>
            </p>
          </div>
          <Button
            size="sm"
            disabled={action.isPending}
            onClick={() => action.mutate({ action: 'generate', payload: { force: true } })}
          >
            {action.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Try again
          </Button>
        </div>
      ) : null}

      {session.status === 'context_needed' || session.status === 'draft' ? (
        <ContextDesk session={session} />
      ) : null}

      {pack && pack.questions ? (
        <>
          <nav className="flex flex-wrap gap-1 border-b">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div>
            {tab === 'overview' && <OverviewTab pack={pack} />}
            {tab === 'fit' && <FitTab pack={pack} />}
            {tab === 'questions' && (
              <QuestionsTab pack={pack} sessionId={sessionId} locked={locked} />
            )}
            {tab === 'agenda' && <AgendaTab pack={pack} sessionId={sessionId} locked={locked} />}
            {tab === 'company' && <CompanyTab pack={pack} />}
            {tab === 'notes' && <SessionNotesPanel session={session} />}
          </div>

          <footer className="flex flex-wrap items-center gap-3 border-t pt-4">
            {locked ? (
              <>
                <span className="flex items-center gap-1.5 text-sm text-green-700">
                  <Lock className="h-4 w-4" />
                  Approved — the student can see this
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ action: 'reopen' })}
                >
                  <Unlock className="mr-1 h-4 w-4" />
                  Reopen to edit
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={action.isPending}
                  onClick={() => action.mutate({ action: 'approve' })}
                >
                  {action.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-4 w-4" />
                  )}
                  Approve and release to the student
                </Button>
                <span className="text-xs text-muted-foreground">
                  Save your question edits first — approving locks the pack.
                </span>
              </>
            )}
            {pack.costUsd ? (
              <span className="ml-auto text-xs text-muted-foreground">
                ${pack.costUsd.toFixed(3)} · {pack.model}
              </span>
            ) : null}
          </footer>
        </>
      ) : null}
    </div>
  )
}
