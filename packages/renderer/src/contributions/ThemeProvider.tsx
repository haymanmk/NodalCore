import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useContributions, type ContributedTheme } from './registry.js'

const STORAGE_KEY = 'nodalcore.activeThemeId'
const NONE = '' // built-in dark theme — no overrides

interface ThemeContextValue {
  /** themeId of the active theme contribution, or '' for the built-in default. */
  activeThemeId: string
  available: ContributedTheme[]
  setActiveThemeId: (themeId: string) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  activeThemeId: NONE,
  available: [],
  setActiveThemeId: () => {},
})

function readStored(): string {
  if (typeof window === 'undefined') return NONE
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? NONE
  } catch {
    return NONE
  }
}

function writeStored(id: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // storage may be unavailable; non-fatal
  }
}

/**
 * Apply a theme's CSS custom-property overrides to <html> (`:root`). Setting
 * vars at the document element makes them cascade to every component without
 * needing a wrapping element. Reverting just deletes the keys we own.
 */
function applyTheme(theme: ContributedTheme | null, lastKeys: Set<string>): Set<string> {
  if (typeof document === 'undefined') return new Set()
  const root = document.documentElement
  for (const key of lastKeys) {
    root.style.removeProperty(key)
  }
  const newKeys = new Set<string>()
  if (!theme) return newKeys
  for (const [key, value] of Object.entries(theme.vars)) {
    // Only apply CSS custom properties (values starting with `--`). Ignores junk.
    if (!key.startsWith('--')) continue
    root.style.setProperty(key, value)
    newKeys.add(key)
  }
  return newKeys
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { contributions } = useContributions()
  const [activeThemeId, setActiveThemeIdState] = useState<string>(() => readStored())
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(() => new Set())

  const active = useMemo(() => {
    if (!activeThemeId) return null
    return contributions.themes.find((t) => t.themeId === activeThemeId) ?? null
  }, [activeThemeId, contributions.themes])

  useEffect(() => {
    const next = applyTheme(active, appliedKeys)
    setAppliedKeys(next)
    // Intentionally only re-runs when the active theme identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const setActiveThemeId = useCallback((id: string) => {
    setActiveThemeIdState(id)
    writeStored(id)
  }, [])

  const value = useMemo(
    () => ({
      activeThemeId,
      available: contributions.themes,
      setActiveThemeId,
    }),
    [activeThemeId, contributions.themes, setActiveThemeId],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
