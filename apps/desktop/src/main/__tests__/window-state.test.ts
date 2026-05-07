import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  bindWindow,
  getWindow,
  isWindowVisible,
  showWindow,
  hideWindow,
  beginQuit,
  isQuitting,
} from '../window-state.js'

interface StubWindow {
  isDestroyed: () => boolean
  isVisible: () => boolean
  isMinimized: () => boolean
  show: () => void
  restore: () => void
  focus: () => void
  hide: () => void
}

function makeWindow(overrides: Partial<StubWindow> = {}): StubWindow {
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    show: vi.fn(),
    restore: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    ...overrides,
  }
}

describe('window-state', () => {
  beforeEach(() => {
    bindWindow(null)
  })

  // NOTE: the `quitting` flag is module-level and there is no resetter
  // (production has no need for one). The `beginQuit + isQuitting` test
  // below is intentionally placed LAST so it doesn't poison earlier tests.
  // If you add new tests, put them before the `beginQuit` test.

  it('isWindowVisible is false when no window is bound', () => {
    expect(isWindowVisible()).toBe(false)
  })

  it('isWindowVisible is true when window is visible and not minimized', () => {
    bindWindow(makeWindow() as never)
    expect(isWindowVisible()).toBe(true)
  })

  it('isWindowVisible is false when window is minimized', () => {
    bindWindow(makeWindow({ isMinimized: () => true }) as never)
    expect(isWindowVisible()).toBe(false)
  })

  it('isWindowVisible is false when window is destroyed', () => {
    bindWindow(makeWindow({ isDestroyed: () => true }) as never)
    expect(isWindowVisible()).toBe(false)
  })

  it('showWindow restores and focuses a hidden window', () => {
    const w = makeWindow({ isVisible: () => false })
    bindWindow(w as never)
    showWindow()
    expect(w.show).toHaveBeenCalled()
    expect(w.focus).toHaveBeenCalled()
  })

  it('showWindow restores a minimized window', () => {
    const w = makeWindow({ isVisible: () => true, isMinimized: () => true })
    bindWindow(w as never)
    showWindow()
    expect(w.restore).toHaveBeenCalled()
    expect(w.focus).toHaveBeenCalled()
  })

  it('hideWindow calls hide on the bound window', () => {
    const w = makeWindow()
    bindWindow(w as never)
    hideWindow()
    expect(w.hide).toHaveBeenCalled()
  })

  it('getWindow returns the bound window', () => {
    const w = makeWindow()
    bindWindow(w as never)
    expect(getWindow()).toBe(w)
  })

  it('beginQuit + isQuitting flips the quit flag', () => {
    expect(isQuitting()).toBe(false)
    beginQuit()
    expect(isQuitting()).toBe(true)
  })
})
