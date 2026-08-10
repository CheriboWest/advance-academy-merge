'use client'

import { Brain, FileText, GraduationCap, MessageCircle, Search } from 'lucide-react'
import type {
  AdminPersonProfile,
  PersonEvent,
  PersonLead,
} from '@advance-academy/contracts/admin-person'
import { houseLabel } from '@advance-academy/contracts/leads'
import { useAdminPerson } from '../hooks/use-person'
import { HttpClientError } from '@/shared/api/http-client'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * Everything known about one person, from either admin table.
 *
 * Both tables are deliberately wide and shallow — a row per person, a column per
 * fact that fits in a word. This is where the facts that do not fit go: what the
 * lead told us in the quiz, how to reach them, and what they have actually done
 * in the product. The last one is the reason it exists: /admin/users could say
 * "has used a tool: ✓" and nothing else, which is not enough to decide whether
 * someone is worth a coach's hour.
 */

const TOOL_ICON: Record<string, typeof FileText> = {
  cv: FileText,
  dream: Search,
  interview: Brain,
}

const CONTACT_STYLE = {
  yes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  no: 'bg-gray-100 text-gray-600 border-gray-200',
} as const

const CONTACT_LABEL = {
  yes: 'Can email',
  pending: 'Unverified',
  no: 'Do not email',
} as const

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—'
}

/** "3 days ago" — the form a coach reads engagement in. */
function ago(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? 'a month ago' : `${months} months ago`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The contact block — the answer to "how do I actually reach this person?". */
function ContactBlock({ lead }: { lead: PersonLead }) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${CONTACT_STYLE[lead.contactable]}`}
        >
          {CONTACT_LABEL[lead.contactable]}
        </span>
        <span className="text-xs text-muted-foreground">{lead.contactReason}</span>
      </div>

      {lead.whatsappDigits ? (
        <a
          href={`https://wa.me/${lead.whatsappDigits}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 transition-colors duration-150 hover:text-emerald-900 hover:underline"
        >
          <MessageCircle className="h-4 w-4" />
          {lead.whatsapp}
        </a>
      ) : lead.whatsapp ? (
        <p className="text-sm text-muted-foreground" title="Not a usable phone number">
          {lead.whatsapp}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No phone number captured.</p>
      )}
    </div>
  )
}

function TimelineRow({ event }: { event: PersonEvent }) {
  const Icon =
    event.kind === 'coaching'
      ? GraduationCap
      : event.kind === 'interview'
        ? Brain
        : (TOOL_ICON[event.detail] ?? FileText)

  return (
    <li className="flex items-start gap-3 border-b py-2 last:border-b-0">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{event.label}</span>
        <span className="text-xs text-muted-foreground">
          {event.kind === 'tool' ? event.detail : `${event.kind} · ${event.detail}`}
        </span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground" title={when(event.at)}>
        {ago(event.at)}
      </span>
    </li>
  )
}

function Profile({ person }: { person: AdminPersonProfile }) {
  const { account, lead, activity, adminTrail } = person
  const tools = Object.entries(activity.byTool)

  return (
    <div className="space-y-6 pb-10">
      {/* Which halves of this person exist at all. */}
      <div className="flex flex-wrap gap-2">
        <Badge variant={account ? 'default' : 'outline'}>
          {account ? `Account · ${account.status}` : 'No account'}
        </Badge>
        <Badge variant={lead ? 'secondary' : 'outline'}>
          {lead ? `Lead · ${lead.source}` : 'No lead record'}
        </Badge>
        {account?.isAdmin ? <Badge variant="destructive">admin</Badge> : null}
      </div>

      {lead ? (
        <Section title="How to reach them">
          <ContactBlock lead={lead} />
        </Section>
      ) : (
        <Section title="How to reach them">
          <p className="text-sm text-muted-foreground">
            No lead record, so no phone number and no marketing consent on file — this account did
            not come through a lead magnet.
          </p>
        </Section>
      )}

      <Section title="Engagement">
        {activity.totalEvents === 0 ? (
          <p className="text-sm text-muted-foreground">
            Has never run a tool, started an interview or booked coaching.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['Last active', ago(activity.lastActiveAt)],
                ['Last 30 days', `${activity.events30d}`],
                ['All time', `${activity.totalEvents}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border p-2 text-center">
                  <div className="text-lg font-semibold tabular-nums">{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            {tools.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Tools: {tools.map(([tool, n]) => `${tool} ×${n}`).join(' · ')}
              </p>
            ) : null}
          </>
        )}
      </Section>

      {activity.timeline.length > 0 ? (
        <Section title={`Activity (${activity.timeline.length} of ${activity.totalEvents})`}>
          <ul className="rounded-lg border px-3">
            {activity.timeline.map((e, i) => (
              <TimelineRow key={`${e.at}-${i}`} event={e} />
            ))}
          </ul>
        </Section>
      ) : null}

      {lead ? (
        <Section title="What the quiz told us">
          <Facts
            rows={[
              ['Archetype', lead.house ? houseLabel(lead.house) : '—'],
              ['Score breakdown', lead.scoreBreakdown ?? '—'],
              ['Lead magnet', lead.leadMagnetId ?? lead.source],
              ['Captured', when(lead.capturedAt)],
              [
                'Channel',
                [lead.utmSource, lead.utmMedium, lead.utmCampaign].filter(Boolean).join(' · ') || '—',
              ],
              ['Marketing opt-in', lead.consentMarketing ? `yes · ${when(lead.consentTs)}` : 'no'],
              ['Double opt-in', lead.doubleOptin ? 'yes' : 'no'],
              ['Lead status', lead.status],
            ]}
          />
        </Section>
      ) : null}

      {account ? (
        <Section title="Account">
          <Facts
            rows={[
              ['Tier', account.tier],
              ['Approval', `${account.status}${account.reviewedAt ? ` · ${when(account.reviewedAt)}` : ''}`],
              ['Credits', account.isAdmin ? '∞' : String(account.credits)],
              ['Coaching left', account.coachingCredits === null ? '∞' : String(account.coachingCredits)],
              ['Referrals', String(account.referralCount)],
              ['Joined', when(account.joinedAt)],
              ['First tool use', when(account.firstToolUsedAt)],
            ]}
          />
        </Section>
      ) : null}

      {adminTrail.length > 0 ? (
        <Section title="Admin trail">
          <ul className="space-y-1 text-xs">
            {adminTrail.map((a, i) => (
              <li key={`${a.at}-${i}`} className="flex gap-2 border-b py-1 last:border-b-0">
                <span className="shrink-0 text-muted-foreground">{when(a.at)}</span>
                <span className="font-medium">{a.action}</span>
                <span className="min-w-0 truncate text-muted-foreground" title={JSON.stringify(a.detail)}>
                  {JSON.stringify(a.detail)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}

export function PersonDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useAdminPerson(id)
  const person = data?.person
  const notFound = error instanceof HttpClientError && error.status === 404

  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="break-words">
            {person ? (person.name ?? person.email) : 'Loading…'}
          </SheetTitle>
          {person?.name ? (
            <p className="text-sm text-muted-foreground">{person.email}</p>
          ) : null}
        </SheetHeader>

        <div className="px-4">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : notFound ? (
            <p className="text-sm text-muted-foreground">
              This id matches neither an account nor a lead — the row may have been deleted.
            </p>
          ) : error ? (
            <p className="text-sm text-destructive">
              Could not load this person: {(error as Error).message}
            </p>
          ) : person ? (
            <Profile person={person} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
