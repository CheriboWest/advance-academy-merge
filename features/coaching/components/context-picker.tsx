'use client'

import type { ContextItem, StudentContextInventory } from '@advance-academy/contracts/coaching'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

/**
 * What the student already has, ready to be attached to a booking.
 *
 * The point is to stop them re-uploading a CV the app is already holding, and to
 * let the coach arrive already knowing what the tools found. Items the pipeline
 * can actually use are pre-ticked; ones with nothing usable behind them are
 * listed but off — chiefly runs from before migration 018, which kept only the
 * output and none of the inputs that made it meaningful.
 */

export interface ContextSelection {
  cvVersionId: string | null
  toolResultIds: string[]
  cvAnalysisJobIds: string[]
}

/** Everything worth attaching, ticked. The form's starting state. */
export function defaultSelection(inventory: StudentContextInventory): ContextSelection {
  return {
    cvVersionId: inventory.cvs.find((c) => c.recommended)?.id ?? inventory.cvs[0]?.id ?? null,
    toolResultIds: [...inventory.dreamRuns, ...inventory.mockInterviews]
      .filter((r) => r.recommended)
      .map((r) => r.id),
    cvAnalysisJobIds: inventory.cvAnalyses.filter((r) => r.recommended).map((r) => r.id),
  }
}

function ItemRow({
  item,
  checked,
  onToggle,
  kind,
}: {
  item: ContextItem
  checked: boolean
  onToggle: () => void
  kind: 'radio' | 'checkbox'
}) {
  const id = `ctx-${item.id}`
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
    >
      {kind === 'radio' ? (
        <input
          id={id}
          type="radio"
          name="cv-version"
          checked={checked}
          onChange={onToggle}
          className="mt-1 h-4 w-4"
        />
      ) : (
        <Checkbox id={id} checked={checked} onCheckedChange={onToggle} className="mt-1" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{item.label}</span>
          {item.recommended ? (
            <Badge variant="secondary" className="text-[10px]">
              suggested
            </Badge>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {item.detail ?? 'nothing usable stored with this run'} ·{' '}
          {new Date(item.createdAt).toLocaleDateString()}
        </span>
      </span>
    </label>
  )
}

function Section({
  title,
  hint,
  items,
  children,
}: {
  title: string
  hint: string
  items: ContextItem[]
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Nothing here yet — that is fine, your coach can work without it.
        </p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

export function ContextPicker({
  inventory,
  selection,
  onChange,
}: {
  inventory: StudentContextInventory
  selection: ContextSelection
  onChange: (next: ContextSelection) => void
}) {
  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  const runs = [...inventory.dreamRuns, ...inventory.mockInterviews]

  return (
    <div className="space-y-6">
      <Section
        title="Which CV should your coach use?"
        hint="Pick one. A CV with parsed bullets lets the pack quote your actual achievements."
        items={inventory.cvs}
      >
        {inventory.cvs.map((cv) => (
          <ItemRow
            key={cv.id}
            item={cv}
            kind="radio"
            checked={selection.cvVersionId === cv.id}
            onToggle={() => onChange({ ...selection, cvVersionId: cv.id })}
          />
        ))}
      </Section>

      <Section
        title="Tool runs to include"
        hint="Your Dream Company and mock interview results tell the coach where you already struggle."
        items={runs}
      >
        {runs.map((run) => (
          <ItemRow
            key={run.id}
            item={run}
            kind="checkbox"
            checked={selection.toolResultIds.includes(run.id)}
            onToggle={() =>
              onChange({ ...selection, toolResultIds: toggleId(selection.toolResultIds, run.id) })
            }
          />
        ))}
      </Section>

      <Section
        title="CV analyses to include"
        hint="Shows which parts of your CV were already flagged as weak."
        items={inventory.cvAnalyses}
      >
        {inventory.cvAnalyses.map((a) => (
          <ItemRow
            key={a.id}
            item={a}
            kind="checkbox"
            checked={selection.cvAnalysisJobIds.includes(a.id)}
            onToggle={() =>
              onChange({
                ...selection,
                cvAnalysisJobIds: toggleId(selection.cvAnalysisJobIds, a.id),
              })
            }
          />
        ))}
      </Section>
    </div>
  )
}
