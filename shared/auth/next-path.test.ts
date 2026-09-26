import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberNextPath, safeNextPath, takeNextPath } from './next-path'

describe('safeNextPath', () => {
  it('keeps same-origin paths with their query', () => {
    expect(safeNextPath('/jobs?add=https%3A%2F%2Fx.com%2Fjob&title=Analyst')).toBe(
      '/jobs?add=https%3A%2F%2Fx.com%2Fjob&title=Analyst',
    )
  })

  it('refuses anything that could leave the site', () => {
    expect(safeNextPath('//evil.com')).toBeNull()
    expect(safeNextPath('/\\evil.com')).toBeNull()
    expect(safeNextPath('https://evil.com')).toBeNull()
    expect(safeNextPath('javascript:alert(1)')).toBeNull()
    expect(safeNextPath('')).toBeNull()
    expect(safeNextPath(null)).toBeNull()
  })
})

describe('remember/take', () => {
  // Node 25+ ships its own `localStorage` global that shadows jsdom's and is
  // inert without --localstorage-file; stand in a real one.
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  it('round-trips once, then is gone', () => {
    rememberNextPath('/cover-letter?savedJob=1')
    expect(takeNextPath()).toBe('/cover-letter?savedJob=1')
    expect(takeNextPath()).toBeNull()
  })

  it('never parks an unsafe path', () => {
    rememberNextPath('//evil.com')
    expect(takeNextPath()).toBeNull()
  })
})
