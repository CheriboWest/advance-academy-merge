'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Asymptotic progress curve: rises fast at first, plateaus near `ceiling`.
// Honest because it never claims to know when the work will finish — it just
// visualises elapsed-time-vs-typical-duration without lying with an ETA.
// progress(t) = ceiling * (1 - exp(-t / tauMs))
//
// Use it for any user-triggered action whose total time is unknowable in
// advance (e.g. an LLM call). Pick `tauMs` ≈ the typical "feels half done" point.

const DEFAULT_CEILING = 92
const TICK_MS = 200

export interface UseFakeProgressOptions {
  /** Half-life of the asymptotic curve in ms. Larger = slower rise. */
  tauMs: number
  /** Max % the bar can reach before the real response lands. Default 92. */
  ceiling?: number
  /** Returns the phase-label string for a given elapsed time. */
  phaseLabel: (elapsedMs: number) => string
}

export interface UseFakeProgressReturn {
  /** Integer-friendly progress value 0–100. */
  progress: number
  /** Current phase label, or empty string when idle. */
  phase: string
  /** True between `start()` and the next `finish()` / `reset()`. */
  busy: boolean
  /** Begin animating from 0 toward the ceiling. */
  start: () => void
  /** Snap to 100% and stop the animation. Call when the real response arrives. */
  finish: () => void
  /** Reset to 0% and clear the phase. Call on error / cancellation. */
  reset: () => void
}

export function useFakeProgress(opts: UseFakeProgressOptions): UseFakeProgressReturn {
  const ceiling = opts.ceiling ?? DEFAULT_CEILING
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('')
  const [busy, setBusy] = useState(false)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  useEffect(() => stop, [stop])

  const start = useCallback(() => {
    stop()
    setProgress(0)
    setPhase(opts.phaseLabel(0))
    setBusy(true)
    const startedAt = performance.now()
    tickRef.current = setInterval(() => {
      const elapsed = performance.now() - startedAt
      const target = ceiling * (1 - Math.exp(-elapsed / opts.tauMs))
      setProgress((prev) => (target > prev ? target : prev))
      setPhase(opts.phaseLabel(elapsed))
    }, TICK_MS)
  }, [stop, ceiling, opts])

  const finish = useCallback(() => {
    stop()
    setProgress(100)
    setBusy(false)
  }, [stop])

  const reset = useCallback(() => {
    stop()
    setProgress(0)
    setPhase('')
    setBusy(false)
  }, [stop])

  return { progress, phase, busy, start, finish, reset }
}
